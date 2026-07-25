"""Ollama provider — local models via /api/chat.

Ollama speaks its own JSON over HTTP, but its tool-calling format is
similar enough to OpenAI's that we mostly translate. We deliberately
hit the raw HTTP API rather than depending on the `ollama` PyPI package
to keep the dependency surface small.
"""

from __future__ import annotations

import json
from typing import Any

from kairo.config import ProviderConfig
from kairo.errors import ProviderError, ProviderUnavailable
from kairo.providers.base import Provider, register_provider
from kairo.providers.openai import _msg_to_openai, _spec_to_openai, _parse_tool_calls
from kairo.types import Message, ProviderResponse, ToolSpec
from kairo.utils import get_logger

log = get_logger("provider.ollama")


@register_provider("ollama")
class OllamaProvider(Provider):
    name = "ollama"

    def _base_url(self) -> str:
        return self.cfg.base_url or "http://localhost:11434"

    def _complete(self, *, messages, tools, model, temperature, max_tokens, **kwargs):
        # Ollama /api/chat accepts an OpenAI-ish payload.
        body: dict[str, Any] = {
            "model": model,
            "messages": [_msg_to_openai(m) for m in messages],
            "stream": False,
            "options": {"temperature": temperature},
        }
        if max_tokens is not None:
            body["options"]["num_predict"] = max_tokens
        if tools:
            body["tools"] = [_spec_to_openai(t) for t in tools]

        url = f"{self._base_url().rstrip('/')}/api/chat"
        try:
            import httpx
            with httpx.Client(timeout=self.cfg.timeout_s) as c:
                resp = c.post(url, json=body)
        except Exception as exc:  # noqa: BLE001
            raise ProviderUnavailable(self.name, f"request failed: {exc}") from exc

        if resp.status_code >= 400:
            raise ProviderError(
                self.name,
                f"HTTP {resp.status_code}: {resp.text[:500]}",
                status=resp.status_code,
                payload=body,
            )
        try:
            data = resp.json()
        except ValueError as exc:
            raise ProviderError(self.name, f"invalid JSON: {exc}") from exc

        msg = data.get("message", {}) or {}
        content = msg.get("content") or ""
        tool_calls = _parse_tool_calls(msg.get("tool_calls") or [])
        return ProviderResponse(
            content=content,
            tool_calls=tool_calls,
            usage={
                "prompt_tokens": (data.get("prompt_eval_count") or 0),
                "completion_tokens": (data.get("eval_count") or 0),
            },
            model=data.get("model"),
            finish_reason="tool_calls" if tool_calls else "stop",
            raw=data,
        )
