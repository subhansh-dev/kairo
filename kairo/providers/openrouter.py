"""OpenRouter provider — multi-model gateway with OpenAI-compatible API."""

from __future__ import annotations

from kairo.providers.base import register_provider
from kairo.providers.openai import OpenAIProvider
from kairo.utils import get_logger

log = get_logger("provider.openrouter")


@register_provider("openrouter")
class OpenRouterProvider(OpenAIProvider):
    """OpenRouter — same wire shape as OpenAI, different default URL."""

    name = "openrouter"

    def _base_url(self) -> str:
        return self.cfg.base_url or "https://openrouter.ai/api/v1"

    def _default_headers(self) -> dict[str, str]:
        # OpenRouter likes these extra headers but they're optional.
        h = super()._default_headers()
        h["HTTP-Referer"] = "https://github.com/kairo"
        h["X-Title"] = "kairo"
        return h
