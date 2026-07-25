"""Model catalog — registry of ModelInfo entries the router can pick from.

The catalog is populated from three sources, in priority order:
  1. User config (``router.models`` in the YAML).
  2. Built-in defaults (see :data:`DEFAULT_MODELS`).
  3. Discovered from providers (e.g. ollama's /api/tags).

Lookups are by ``"<provider>:<model>"`` string — this is what
``RouterConfig.default_model`` and ``overrides`` reference.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Iterable

from kairo.errors import RouterError
from kairo.types import ModelInfo, ProviderName
from kairo.utils import get_logger

log = get_logger("routing.catalog")


def _key(provider: str | ProviderName, model: str) -> str:
    return f"{provider}:{model}"


@dataclass(slots=True)
class ModelCatalog:
    """Thread-safe registry of ModelInfo entries."""

    _models: dict[str, ModelInfo] = field(default_factory=dict, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    def add(self, info: ModelInfo) -> None:
        with self._lock:
            self._models[_key(info.provider, info.name)] = info

    def add_many(self, infos: Iterable[ModelInfo]) -> None:
        for info in infos:
            self.add(info)

    def get(self, provider: str | ProviderName, model: str) -> ModelInfo:
        with self._lock:
            key = _key(provider, model)
            info = self._models.get(key)
        if info is None:
            raise RouterError(f"unknown model {key!r}")
        return info

    def get_by_key(self, key: str) -> ModelInfo:
        if ":" not in key:
            raise RouterError(f"invalid model key {key!r} (expected '<provider>:<model>')")
        provider, model = key.split(":", 1)
        return self.get(provider, model)

    def all(self) -> list[ModelInfo]:
        with self._lock:
            return list(self._models.values())

    def providers(self) -> list[str]:
        with self._lock:
            return sorted({m.provider for m in self._models.values()})

    def __len__(self) -> int:
        with self._lock:
            return len(self._models)

    def __contains__(self, key: str) -> bool:
        with self._lock:
            return key in self._models


# ---------------------------------------------------------------------------
# Built-in defaults
# ---------------------------------------------------------------------------

DEFAULT_MODELS: list[ModelInfo] = [
    # OpenAI
    ModelInfo("gpt-4o", "openai", context=128_000, cost_in_per_m=2.5, cost_out_per_m=10,
              tps=80, capabilities=("code", "plan", "tools", "vision"), parallel_tools=True),
    ModelInfo("gpt-4o-mini", "openai", context=128_000, cost_in_per_m=0.15, cost_out_per_m=0.6,
              tps=120, capabilities=("code", "tools", "general"), parallel_tools=True),
    ModelInfo("gpt-4-turbo", "openai", context=128_000, cost_in_per_m=10, cost_out_per_m=30,
              tps=60, capabilities=("code", "plan", "tools", "vision"), parallel_tools=True),
    ModelInfo("o1-mini", "openai", context=128_000, cost_in_per_m=1.1, cost_out_per_m=4.4,
              tps=30, capabilities=("reason", "plan"), parallel_tools=False),
    # Anthropic
    ModelInfo("claude-3-5-sonnet-20241022", "anthropic", context=200_000,
              cost_in_per_m=3, cost_out_per_m=15, tps=80,
              capabilities=("code", "plan", "tools", "vision", "long-context"), parallel_tools=True),
    ModelInfo("claude-3-5-haiku-20241022", "anthropic", context=200_000,
              cost_in_per_m=0.8, cost_out_per_m=4, tps=120,
              capabilities=("code", "tools", "general"), parallel_tools=True),
    ModelInfo("claude-3-opus-20240229", "anthropic", context=200_000,
              cost_in_per_m=15, cost_out_per_m=75, tps=30,
              capabilities=("code", "plan", "tools", "vision", "long-context"), parallel_tools=True),
    # OpenRouter (route to upstream providers, pricing in OpenRouter credits)
    ModelInfo("anthropic/claude-3.5-sonnet", "openrouter", context=200_000,
              cost_in_per_m=3, cost_out_per_m=15, tps=80,
              capabilities=("code", "plan", "tools", "long-context"), parallel_tools=True),
    ModelInfo("openai/gpt-4o-mini", "openrouter", context=128_000,
              cost_in_per_m=0.15, cost_out_per_m=0.6, tps=120,
              capabilities=("code", "tools", "general"), parallel_tools=True),
    ModelInfo("meta-llama/llama-3.1-70b-instruct", "openrouter", context=131_072,
              cost_in_per_m=0.4, cost_out_per_m=0.8, tps=120,
              capabilities=("code", "tools", "general"), parallel_tools=True),
    ModelInfo("nousresearch/hermes-2-pro-llama-3-8b", "openrouter", context=8192,
              cost_in_per_m=0.2, cost_out_per_m=0.2, tps=150,
              capabilities=("tools", "general"), parallel_tools=False, native_tools=False),
    # Ollama (local, free, but limited)
    ModelInfo("llama3.1:8b", "ollama", context=32_768, cost_in_per_m=0, cost_out_per_m=0,
              tps=60, capabilities=("code", "general"), parallel_tools=False, native_tools=False),
    ModelInfo("llama3.1:70b", "ollama", context=32_768, cost_in_per_m=0, cost_out_per_m=0,
              tps=20, capabilities=("code", "plan", "general"), parallel_tools=False, native_tools=False),
    ModelInfo("qwen2.5-coder:7b", "ollama", context=32_768, cost_in_per_m=0, cost_out_per_m=0,
              tps=80, capabilities=("code",), parallel_tools=False, native_tools=False),
    ModelInfo("nousresearch/hermes-2-pro-llama-3-8b", "ollama", context=8192,
              cost_in_per_m=0, cost_out_per_m=0, tps=120,
              capabilities=("tools",), parallel_tools=False, native_tools=False),
    # GLM (ZAI)
    ModelInfo("glm-4.6", "glm", context=128_000, cost_in_per_m=0.6, cost_out_per_m=2.2,
              tps=100, capabilities=("code", "tools", "general", "long-context"), parallel_tools=True),
    ModelInfo("glm-4.5", "glm", context=128_000, cost_in_per_m=0.5, cost_out_per_m=1.8,
              tps=120, capabilities=("code", "tools", "general"), parallel_tools=True),
    ModelInfo("glm-4-flash", "glm", context=128_000, cost_in_per_m=0, cost_out_per_m=0,
              tps=200, capabilities=("general",), parallel_tools=True),
    # Hermes-XML (local server hosting Nous Hermes-2-Pro via vLLM etc.)
    ModelInfo("NousResearch/Hermes-2-Pro-Llama-3-8B", "hermes_xml", context=8192,
              cost_in_per_m=0, cost_out_per_m=0, tps=80,
              capabilities=("tools", "general"), parallel_tools=False, native_tools=False),
]


def default_catalog() -> ModelCatalog:
    """Return a fresh ModelCatalog populated with :data:`DEFAULT_MODELS`."""
    c = ModelCatalog()
    c.add_many(DEFAULT_MODELS)
    return c
