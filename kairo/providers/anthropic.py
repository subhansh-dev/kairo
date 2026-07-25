"""Anthropic provider — uses the Messages API with tool_use blocks.

Translates Kairo messages <-> Anthropic's content-block format. Anthropic
puts tool calls and tool results inside the ``content`` array as typed
blocks rather than as separate top-level fields, so the translation is
slightly more involved than OpenAI.
"""

from __future__ import annotations

import json
from typing import Any

from kairo.config import ProviderConfig
from kairo.errors import ProviderError, ProviderUnavailable, RateLimitError
from kairo.providers.base import Provider, register_provider
from kairo.types import Message, ProviderResponse, Role, ToolCall, ToolSpec
from kairo.utils import get_logger

log = get_logger("provider.anthropic")


def _stringify(v: Any) -> str:
    if isinstance(v, str):
        return v
    try:
        return json.dumps(v, default=str)
    except (TypeError, ValueError):
        return str(v)


def _msg_to_anthropic(m: Message) -> tuple[str, list[dict] | str]:
    """Return (role, content) in Anthropic's format."""
    if m.role == Role.TOOL:
        assert m.tool_result is not None
        # Anthropic expects tool_result blocks inside a "user" turn.
        return "user", [
            {
                "type": "tool_result",
                "tool_use_id": m.tool_result.call_id,
                "content": _stringify(m.tool_result.content),
                "is_error": not m.tool_result.ok,
            }
        ]
    if m.role == Role.ASSISTANT and m.tool_calls:
        blocks: list[dict] = []
        if m.content:
            blocks.append({"type": "text", "text": m.content})
        for tc in m.tool_calls:
            blocks.append(
                {
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.arguments,
                }
            )
        return "assistant", blocks
    return m.role.value, m.content


def _spec_to_anthropic(spec: ToolSpec) -> dict[str, Any]:
    return {
        "name": spec.name,
        "description": spec.description,
        "input_schema": spec.parameters,
    }


def _parse_blocks(blocks: list[dict]) -> tuple[str, list[ToolCall]]:
    content_parts: list[str] = []
    calls: list[ToolCall] = []
    for b in blocks or []:
        t = b.get("type")
        if t == "text":
            content_parts.append(b.get("text", ""))
        elif t == "tool_use":
            calls.append(
                ToolCall(
                    name=b.get("name", ""),
                    arguments=b.get("input", {}) or {},
                    provider_id=b.get("id"),
                )
            )
    return "\n".join(content_parts).strip(), calls


@register_provider("anthropic")
class AnthropicProvider(Provider):
    name = "anthropic"

    def _base_url(self) -> str:
        return self.cfg.base_url or "https://api.anthropic.com"

    def _headers(self) -> dict[str, str]:
        h = self._default_headers()
        key = self.cfg.api_key()
        if key:
            h["x-api-key"] = key
        h["anthropic-version"] = "2023-06-01"
        return h

    def _complete(self, *, messages, tools, model, temperature, max_tokens, **kwargs):
        # Anthropic requires max_tokens, so default it if missing.
        if max_tokens is None:
            max_tokens = 4096

        # Split system messages out — Anthropic takes system as a top-level field.
        system_parts: list[str] = []
        chat_msgs: list[dict] = []
        for m in messages:
            if m.role == Role.SYSTEM:
                if m.content:
                    system_parts.append(m.content)
                continue
            role, content = _msg_to_anthropic(m)
            chat_msgs.append({"role": role, "content": content})

        body: dict[str, Any] = {
            "model": model,
            "messages": chat_msgs,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if system_parts:
            body["system"] = "\n\n".join(system_parts)
        if tools:
            body["tools"] = [_spec_to_anthropic(t) for t in tools]
        body.update(kwargs)

        url = f"{self._base_url().rstrip('/')}/v1/messages"
        try:
            import httpx
            with httpx.Client(timeout=self.cfg.timeout_s, headers=self._headers()) as c:
                resp = c.post(url, json=body)
        except Exception as exc:  # noqa: BLE001
            raise ProviderUnavailable(self.name, f"request failed: {exc}") from exc

        if resp.status_code == 429:
            raise RateLimitError(self.name, "rate limited", status=429)
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

        content, tool_calls = _parse_blocks(data.get("content") or [])
        usage = data.get("usage") or {}
        return ProviderResponse(
            content=content,
            tool_calls=tool_calls,
            usage=usage,
            model=data.get("model"),
            finish_reason=data.get("stop_reason"),
            raw=data,
        )
