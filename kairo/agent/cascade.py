"""Cascade router — escalate weak→strong model when confidence is low.

Real-world edge deployment pattern: try the cheapest model first. If it
produces a low-confidence answer or fails outright, escalate to a
stronger (more expensive) model. This is the "speculative cascade"
pattern from recent LLM serving research.

Two cascade strategies:
  * ``error_cascade``: try model A; on error, try model B; etc.
  * ``confidence_cascade``: try model A; if its confidence score is
    below a threshold, try model B and pick the better answer.

Confidence scoring is pluggable. The default scorer uses a simple
heuristic (response length + finish_reason + tool-call success rate).
For real use, swap in an LLM-as-judge scorer.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from kairo.config import KairoConfig
from kairo.errors import KairoError, ProviderError, ProviderUnavailable, RateLimitError
from kairo.providers import build_all_enabled
from kairo.providers.base import Provider
from kairo.routing.catalog import ModelCatalog
from kairo.types import Message, ProviderResponse, ToolSpec
from kairo.utils import get_logger

log = get_logger("routing.cascade")


CascadeStrategy = Literal["error", "confidence"]


# A confidence scorer takes (messages, response) and returns a float
# in [0.0, 1.0]. Higher = more confident.
ConfidenceScorer = Callable[[list[Message], ProviderResponse], float]


def default_confidence_scorer(messages: list[Message], resp: ProviderResponse) -> float:
    """Heuristic confidence scorer.

    Combines:
      * finish_reason: "stop" → 0.5 base, "length" → 0.2, others → 0.3
      * length: longer responses (up to a cap) score higher
      * tool calls: presence of tool calls adds 0.1 (model took action)
      * usage: higher token usage modestly increases confidence
    """
    base = 0.5
    if resp.finish_reason == "stop":
        base = 0.6
    elif resp.finish_reason == "length":
        base = 0.2
    elif resp.finish_reason == "tool_calls":
        base = 0.7

    # Length factor: 0..500 chars adds up to +0.2.
    length_bonus = min(0.2, len(resp.content) / 2500)
    # Tool calls: each adds 0.05, capped at +0.15.
    tool_bonus = min(0.15, 0.05 * len(resp.tool_calls))
    # Token usage: small bonus for non-trivial completions.
    usage = resp.usage or {}
    completion_tokens = usage.get("completion_tokens", 0)
    token_bonus = min(0.1, completion_tokens / 1000)

    return min(1.0, base + length_bonus + tool_bonus + token_bonus)


@dataclass(slots=True)
class CascadeConfig:
    """Cascade router configuration."""

    enabled: bool = True
    strategy: CascadeStrategy = "confidence"
    # Confidence threshold below which we escalate. Only used for
    # ``confidence`` strategy.
    confidence_threshold: float = 0.4
    # Max cascade attempts (not counting the primary).
    max_attempts: int = 2
    # Seconds to wait between attempts.
    backoff_s: float = 1.0


@dataclass(slots=True)
class CascadeResult:
    """Outcome of a cascade run."""

    response: ProviderResponse
    attempts: list[tuple[str, str, float, ProviderResponse | Exception]]
    # The (provider, model) that succeeded.
    winner: tuple[str, str]
    # Confidence score of the winning response.
    confidence: float
    # Wall-clock duration.
    duration_s: float


class CascadeRouter:
    """Try cheap models first, escalate to stronger ones when needed.

    Pass an ordered list of ``(provider, model)`` pairs — the first is
    the primary (cheapest), then fallbacks in increasing cost.
    """

    def __init__(
        self,
        kairo_cfg: KairoConfig,
        catalog: ModelCatalog,
        chain: list[tuple[str, str]],
        cfg: CascadeConfig | None = None,
        scorer: ConfidenceScorer | None = None,
    ) -> None:
        if not chain:
            raise ValueError("cascade chain must have at least one (provider, model) pair")
        self.kcfg = kairo_cfg
        self.catalog = catalog
        self.chain = list(chain)
        self.cfg = cfg or CascadeConfig()
        self.scorer = scorer or default_confidence_scorer
        self._providers: dict[str, Provider] = build_all_enabled(kairo_cfg)

    def complete(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        *,
        temperature: float = 0.0,
        max_tokens: int | None = None,
        **kwargs: Any,
    ) -> CascadeResult:
        """Try the chain in order, escalating as needed."""
        start = time.time()
        attempts: list[tuple[str, str, float, ProviderResponse | Exception]] = []
        best: tuple[float, ProviderResponse, str, str] | None = None

        max_attempts = min(self.cfg.max_attempts + 1, len(self.chain))
        for i, (provider_name, model_name) in enumerate(self.chain[:max_attempts]):
            provider = self._providers.get(provider_name)
            if provider is None:
                log.warning("cascade: provider %s not available, skipping", provider_name)
                continue
            try:
                resp = provider.complete(
                    messages=messages,
                    tools=tools,
                    model=model_name,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs,
                )
                conf = self.scorer(messages, resp)
                attempts.append((provider_name, model_name, conf, resp))
                log.info("cascade attempt %d: %s:%s confidence=%.2f",
                         i + 1, provider_name, model_name, conf)

                if self.cfg.strategy == "error":
                    # In error mode, first success wins.
                    return CascadeResult(
                        response=resp,
                        attempts=attempts,
                        winner=(provider_name, model_name),
                        confidence=conf,
                        duration_s=time.time() - start,
                    )

                # confidence mode: track best, escalate if below threshold.
                if best is None or conf > best[0]:
                    best = (conf, resp, provider_name, model_name)
                if conf >= self.cfg.confidence_threshold:
                    # Good enough — stop cascading.
                    return CascadeResult(
                        response=resp,
                        attempts=attempts,
                        winner=(provider_name, model_name),
                        confidence=conf,
                        duration_s=time.time() - start,
                    )
            except (RateLimitError, ProviderUnavailable, ProviderError) as exc:
                log.warning("cascade attempt %d failed (%s:%s): %s",
                            i + 1, provider_name, model_name, exc)
                attempts.append((provider_name, model_name, 0.0, exc))
                if i < len(self.chain) - 1:
                    time.sleep(self.cfg.backoff_s)

        if best is None:
            raise KairoError("cascade exhausted all providers without any response")
        return CascadeResult(
            response=best[1],
            attempts=attempts,
            winner=(best[2], best[3]),
            confidence=best[0],
            duration_s=time.time() - start,
        )


def build_cascade_from_catalog(
    kairo_cfg: KairoConfig,
    catalog: ModelCatalog,
    *,
    required_caps: tuple[str, ...] = (),
    max_chain: int = 3,
) -> list[tuple[str, str]]:
    """Build a cascade chain sorted by cost (cheapest first)."""
    candidates = []
    for info in catalog.all():
        if info.provider not in kairo_cfg.providers:
            continue
        if not kairo_cfg.providers[info.provider].enabled:
            continue
        if required_caps and not set(required_caps).issubset(set(info.capabilities)):
            continue
        candidates.append(info)
    candidates.sort(key=lambda m: m.cost_in_per_m + m.cost_out_per_m)
    return [(m.provider, m.name) for m in candidates[:max_chain]]
