"""Provider failover — retry on a different provider/model when one fails.

When a provider call fails with a non-terminal error (network timeout,
5xx, rate limit), Kairo can failover to a different provider with a
similar-capability model instead of giving up. This is especially
useful when running against free APIs that have aggressive rate limits
or against local models that occasionally crash.

Failover is implemented as a wrapper around :class:`Provider` that
holds a list of fallback ``(provider, model)`` pairs and tries each in
order until one succeeds or all fail.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from kairo.config import KairoConfig
from kairo.errors import (
    KairoError,
    ProviderError,
    ProviderUnavailable,
    RateLimitError,
)
from kairo.providers import build_all_enabled
from kairo.providers.base import Provider
from kairo.routing.catalog import ModelCatalog
from kairo.types import Message, ProviderName, ProviderResponse, ToolSpec
from kairo.utils import get_logger

log = get_logger("provider.failover")


# Errors that justify a failover (vs. errors that mean "give up").
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


@dataclass(slots=True)
class FailoverConfig:
    """Configuration for the failover wrapper."""

    # When True, failover is enabled.
    enabled: bool = True
    # Max failover attempts (not counting the primary call).
    max_attempts: int = 3
    # Seconds to wait between attempts.
    backoff_s: float = 2.0
    # When True, prefer the same capability tier when picking a fallback.
    match_capabilities: bool = True


class FailoverProvider:
    """Wraps a primary provider with N fallbacks.

    The wrapper looks like a :class:`Provider` to the agent loop but
    internally tries each fallback in order until one succeeds.
    """

    def __init__(
        self,
        primary: Provider,
        primary_model: str,
        fallbacks: list[tuple[Provider, str]],
        cfg: FailoverConfig | None = None,
    ) -> None:
        self.primary = primary
        self.primary_model = primary_model
        self.fallbacks = list(fallbacks)
        self.cfg = cfg or FailoverConfig()
        # We expose the primary's name so the agent loop sees a stable
        # provider name in metadata.
        self.name = primary.name

    def complete(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        *,
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int | None = None,
        **kwargs: Any,
    ) -> ProviderResponse:
        # Build the attempt list: primary first, then up to max_attempts fallbacks.
        all_attempts: list[tuple[Provider, str]] = [(self.primary, model or self.primary_model)]
        all_attempts.extend(self.fallbacks)
        if self.cfg.enabled:
            # Primary + max_attempts fallbacks.
            attempts = all_attempts[: 1 + self.cfg.max_attempts]
        else:
            attempts = all_attempts[:1]  # primary only
        last_err: Exception | None = None
        for i, (provider, fallback_model) in enumerate(attempts):
            try:
                resp = provider.complete(
                    messages=messages,
                    tools=tools,
                    model=fallback_model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs,
                )
                if i > 0:
                    log.info("failover to %s:%s succeeded (after %s:%s failed)",
                             provider.name, fallback_model,
                             self.primary.name, self.primary_model)
                return resp
            except (RateLimitError, ProviderUnavailable) as exc:
                last_err = exc
                log.warning("provider %s:%s failed (rate/unavail): %s; failing over",
                            provider.name, fallback_model, exc)
                if i < len(attempts) - 1:
                    time.sleep(self.cfg.backoff_s)
            except ProviderError as exc:
                last_err = exc
                if exc.status in _RETRYABLE_STATUS:
                    log.warning("provider %s:%s HTTP %s; failing over",
                                provider.name, fallback_model, exc.status)
                    if i < len(attempts) - 1:
                        time.sleep(self.cfg.backoff_s)
                else:
                    # Non-retryable: re-raise immediately.
                    raise
        if last_err is not None:
            raise last_err
        raise KairoError("failover exhausted all providers without success or error")


def build_failover_chain(
    kairo_cfg: KairoConfig,
    catalog: ModelCatalog,
    primary_provider: str,
    primary_model: str,
    *,
    required_caps: tuple[str, ...] = (),
    max_fallbacks: int = 3,
) -> FailoverProvider:
    """Build a FailoverProvider by finding similar models in the catalog.

    Picks up to ``max_fallbacks`` other models with the same
    capability tags, sorted by cost (cheapest first).
    """
    providers = build_all_enabled(kairo_cfg)
    primary = providers.get(primary_provider)
    if primary is None:
        raise ProviderUnavailable(primary_provider, "primary provider not available")

    # Find fallback candidates.
    candidates = []
    for info in catalog.all():
        if info.provider == primary_provider and info.name == primary_model:
            continue
        if info.provider not in providers:
            continue
        if required_caps and not set(required_caps).issubset(set(info.capabilities)):
            continue
        candidates.append((info, providers[info.provider]))
    # Sort by cost (cheapest first).
    candidates.sort(key=lambda x: x[0].cost_in_per_m + x[0].cost_out_per_m)
    fallbacks = [(p, info.name) for info, p in candidates[:max_fallbacks]]
    return FailoverProvider(primary, primary_model, fallbacks)
