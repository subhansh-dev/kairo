"""OpenAI-compatible provider.

Works against the official OpenAI API and any server that implements the
same shape (e.g. LM Studio, vLLM with --serve, OpenRouter via the same
client). When the request sets ``tools``, we send them as OpenAI function
calling and parse ``tool_calls`` from the response.
"""

from __future__ import annotations

import json
from typing import Any

from kairo.config import ProviderConfig
from kairo.errors import ProviderError, ProviderUnavailable, RateLimitError
from kairo.providers.base import Provider, register_provider
from kairo.types import Message, ProviderResponse, Role, ToolCall, ToolSpec
from kairo.utils import get_logger

log = get_logger("provider.openai")


def _msg_to_openai(m: Message) -> dict[str, Any]:
    """Translate a Kairo Message to the OpenAI chat-schema shape."""
    if m.role == Role.TOOL:
        # tool result
        assert m.tool_result is not None
        return {
            "role": "tool",
            "tool_call_id": m.tool_result.call_id,
            "content": _stringify(m.tool_result.content),
        }
    d: dict[str, Any] = {"role": m.role.value, "content": m.content}
    if m.tool_calls:
        d["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
            }
            for tc in m.tool_calls
        ]
    return d


def _stringify(v: Any) -> str:
    if isinstance(v, str):
        return v
    try:
        return json.dumps(v, default=str)
    except (TypeError, ValueError):
        return str(v)


def _spec_to_openai(spec: ToolSpec) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": spec.parameters,
        },
    }


def _parse_tool_calls(raw: list[dict]) -> list[ToolCall]:
    out: list[ToolCall] = []
    for rc in raw or []:
        fn = rc.get("function") or {}
        name = fn.get("name")
        if not name:
            continue
        args_raw = fn.get("arguments", "{}")
        try:
            args = json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
        except json.JSONDecodeError:
            args = {"_raw": args_raw}
        out.append(
            ToolCall(
                name=name,
                arguments=args,
                provider_id=rc.get("id"),
            )
        )
    return out


@register_provider("openai")
class OpenAIProvider(Provider):
    name = "openai"

    def _base_url(self) -> str:
        return self.cfg.base_url or "https://api.openai.com/v1"

    def _headers(self) -> dict[str, str]:
        h = self._default_headers()
        key = self.cfg.api_key()
        if key:
            h["Authorization"] = f"Bearer {key}"
        return h

    def _complete(self, *, messages, tools, model, temperature, max_tokens, **kwargs):
        body: dict[str, Any] = {
            "model": model,
            "messages": [_msg_to_openai(m) for m in messages],
            "temperature": temperature,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if tools:
            body["tools"] = [_spec_to_openai(t) for t in tools]
        body.update(kwargs)

        url = f"{self._base_url().rstrip('/')}/chat/completions"
        try:
            with __import__("httpx").Client(timeout=self.cfg.timeout_s, headers=self._headers()) as c:
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

        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {})
        content = msg.get("content") or ""
        tool_calls = _parse_tool_calls(msg.get("tool_calls") or [])
        return ProviderResponse(
            content=content,
            tool_calls=tool_calls,
            usage=data.get("usage"),
            model=data.get("model"),
            finish_reason=choice.get("finish_reason"),
            raw=data,
        )
