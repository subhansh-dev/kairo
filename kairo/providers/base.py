"""Provider base class + adapter interface.

A provider is anything that can take a list of :class:`Message` and a
list of :class:`ToolSpec` and return a :class:`ProviderResponse`. We
keep the interface tiny so adding a new provider is a few hundred lines.

Concrete providers live in sibling modules. Each one:
  1. Translates Kairo messages to the provider's wire format.
  2. Calls the provider's SDK (or raw HTTP).
  3. Translates the response back into a :class:`ProviderResponse`.
"""

from __future__ import annotations

import abc
import time
from dataclasses import dataclass
from typing import Any

import httpx

from kairo.config import ProviderConfig
from kairo.errors import ProviderError, ProviderUnavailable, RateLimitError
from kairo.types import Message, ProviderName, ProviderResponse, ToolSpec
from kairo.utils import get_logger

log = get_logger("provider")


class Provider(abc.ABC):
    """Abstract provider.

    Subclasses must implement :meth:`_complete`. The base class handles
    retry / timeout / error-translation so concrete providers can stay
    short.
    """

    name: ProviderName

    def __init__(self, cfg: ProviderConfig) -> None:
        self.cfg = cfg
        self._client: httpx.Client | None = None

    # -- public API ----------------------------------------------------

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
        """Synchronous completion entry point."""
        if not self.cfg.enabled:
            raise ProviderUnavailable(self.name, "provider is disabled in config")
        model = model or self.cfg.default_model
        if not model:
            raise ProviderUnavailable(self.name, "no default_model configured")
        start = time.time()
        last_err: Exception | None = None
        for attempt in range(1, self.cfg.max_retries + 1):
            try:
                resp = self._complete(
                    messages=messages,
                    tools=tools,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs,
                )
                resp.latency_s = time.time() - start
                resp.model = resp.model or model
                return resp
            except RateLimitError as e:
                last_err = e
                wait = min(2 ** attempt, 30)
                log.warning("rate-limited by %s; retrying in %ss", self.name, wait)
                time.sleep(wait)
            except ProviderError as e:
                last_err = e
                if e.status is not None and 400 <= e.status < 500 and e.status != 429:
                    raise  # client errors are not retryable
                wait = min(2 ** attempt, 30)
                log.warning("provider %s error (attempt %d): %s", self.name, attempt, e)
                time.sleep(wait)
        assert last_err is not None
        raise last_err

    @abc.abstractmethod
    def _complete(
        self,
        *,
        messages: list[Message],
        tools: list[ToolSpec] | None,
        model: str,
        temperature: float,
        max_tokens: int | None,
        **kwargs: Any,
    ) -> ProviderResponse:
        """Perform a single completion attempt. Implemented by subclasses."""

    # -- helpers -------------------------------------------------------

    def _http_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=self.cfg.timeout_s,
                headers=self._default_headers(),
            )
        return self._client

    def _default_headers(self) -> dict[str, str]:
        return {"User-Agent": "kairo/0.1"}

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None


# ---------------------------------------------------------------------------
# Registry of providers
# ---------------------------------------------------------------------------

_PROVIDERS: dict[str, type[Provider]] = {}


def register_provider(name: str) -> Callable[[type[Provider]], type[Provider]]:
    """Class decorator to register a Provider subclass under ``name``."""
    def _wrap(cls: type[Provider]) -> type[Provider]:
        _PROVIDERS[name] = cls
        return cls
    return _wrap


def get_provider_class(name: str) -> type[Provider]:
    if name not in _PROVIDERS:
        raise ProviderUnavailable(name, f"no provider registered as {name!r}")
    return _PROVIDERS[name]


def available_providers() -> list[str]:
    return sorted(_PROVIDERS.keys())


# late import to keep the type hint usable
from typing import Callable  # noqa: E402
