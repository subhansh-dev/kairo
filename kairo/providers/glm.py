"""GLM (ZAI) provider — OpenAI-compatible API at https://api.z.ai/api/paas/v4.

ZAI exposes an OpenAI-compatible chat completions endpoint, so this is
a thin wrapper that re-uses the OpenAI translator and only overrides
the URL + auth header conventions.

For the internal Z.ai endpoint (``https://internal-api.z.ai/v1``) this
provider also sends an ``X-Token`` header populated from the
``ZAI_TOKEN`` env var when present — that endpoint requires both
``Authorization: Bearer Z.ai`` and the JWT in ``X-Token``.
"""

from __future__ import annotations

import os

from kairo.providers.base import register_provider
from kairo.providers.openai import OpenAIProvider
from kairo.utils import get_logger

log = get_logger("provider.glm")


@register_provider("glm")
class GLMProvider(OpenAIProvider):
    """ZAI / GLM provider (OpenAI-compatible)."""

    name = "glm"

    def _base_url(self) -> str:
        return self.cfg.base_url or "https://api.z.ai/api/paas/v4"

    def _default_headers(self) -> dict[str, str]:
        h = super()._default_headers()
        # The internal z.ai endpoint requires this marker header on every call.
        h["X-Z-AI-From"] = "Z"
        # The internal z.ai endpoint needs an X-Token JWT in addition to
        # the Authorization Bearer. We pick it up from ZAI_TOKEN when set.
        x_token = os.environ.get("ZAI_TOKEN")
        if x_token:
            h["X-Token"] = x_token
        # Some ZAI endpoints also expect a chat-id + user-id pair.
        chat_id = os.environ.get("ZAI_CHAT_ID")
        if chat_id:
            h["X-Chat-Id"] = chat_id
        user_id = os.environ.get("ZAI_USER_ID")
        if user_id:
            h["X-User-Id"] = user_id
        return h

    def _complete(self, *, messages, tools, model, temperature, max_tokens, **kwargs):
        # The internal Z.ai endpoint expects a `thinking` field in the body.
        # Default to disabled — we don't want chain-of-thought tokens in
        # tool-calling turns.
        kwargs.setdefault("thinking", {"type": "disabled"})
        return super()._complete(
            messages=messages,
            tools=tools,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs,
        )
