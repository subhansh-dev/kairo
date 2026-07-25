"""XML tool-call provider — for models that emit tool calls as XML tags.

Supports any chat-completions-style endpoint whose model emits tool
calls as XML tags, e.g.::

    <tool_call>
    {"name": "read_file", "arguments": {"path": "foo.py"}}
    </tool_call>

The parser is deliberately robust: json.loads first, ast.literal_eval
as a fallback (open-weight models often emit single-quoted "JSON" that
is actually Python literal syntax), and a markdown-code-fence fallback
for ```` ```json ```` blocks.
"""

from __future__ import annotations

import ast
import json
import re
import xml.etree.ElementTree as ET
from typing import Any

from kairo.config import ProviderConfig
from kairo.errors import ProviderError, ProviderUnavailable, RateLimitError
from kairo.providers.base import register_provider
from kairo.providers.openai import OpenAIProvider, _msg_to_openai, _parse_tool_calls
from kairo.types import Message, ProviderResponse, Role, ToolCall, ToolResult, ToolSpec
from kairo.utils import get_logger

log = get_logger("provider.hermes_xml")


_TOOL_CALL_RE = re.compile(r"<tool_call>(.*?)</tool_call>", re.DOTALL)
_TOOL_RESULT_OPEN = "<tool_response>"
_TOOL_RESULT_CLOSE = "</tool_response>"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def extract_tool_calls(assistant_text: str) -> tuple[list[ToolCall], str | None]:
    """Parse XML-style ``<tool_call>{json}</tool_call>`` blocks.

    Returns ``(calls, error)``. ``error`` is non-None if parsing failed
    for any of the calls — callers should feed it back to the model.
    """
    calls: list[ToolCall] = []
    errors: list[str] = []

    wrapped = f"<root>{assistant_text}</root>"
    try:
        root = ET.fromstring(wrapped)
    except ET.ParseError as exc:
        for m in _TOOL_CALL_RE.finditer(assistant_text):
            _parse_one(m.group(1), calls, errors)
        if not calls:
            return [], f"XML parse error: {exc}"
        return calls, ("\n".join(errors) if errors else None)

    for el in root.findall(".//tool_call"):
        _parse_one(el.text or "", calls, errors)

    if not calls and "<tool_call>" in assistant_text:
        for m in _TOOL_CALL_RE.finditer(assistant_text):
            _parse_one(m.group(1), calls, errors)

    return calls, ("\n".join(errors) if errors else None)


def _parse_one(text: str, calls: list[ToolCall], errors: list[str]) -> None:
    raw = text.strip()
    if not raw:
        return
    data: Any = None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as json_err:
        try:
            data = ast.literal_eval(raw)
        except (SyntaxError, ValueError) as eval_err:
            data = _extract_json_from_markdown(raw)
            if data is None:
                errors.append(
                    f"Could not parse tool_call JSON: json={json_err}; "
                    f"literal_eval={eval_err}; raw={raw[:200]!r}"
                )
                return
    if isinstance(data, dict):
        calls.append(_dict_to_call(data))
    elif isinstance(data, list):
        for d in data:
            if isinstance(d, dict):
                calls.append(_dict_to_call(d))
    else:
        errors.append(f"tool_call JSON was not an object/list: {type(data).__name__}")


def _dict_to_call(d: dict[str, Any]) -> ToolCall:
    name = d.get("name") or ""
    args = d.get("arguments") or d.get("args") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            try:
                args = ast.literal_eval(args)
            except (SyntaxError, ValueError):
                args = {"_raw": args}
    if not isinstance(args, dict):
        args = {"_value": args}
    return ToolCall(name=name, arguments=args)


def _extract_json_from_markdown(text: str) -> Any:
    match = re.search(r"```json\r?\n(.*?)\r?\n```", text, re.DOTALL)
    if not match:
        match = re.search(r"```\r?\n(.*?)\r?\n```", text, re.DOTALL)
    if not match:
        return None
    s = match.group(1)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        try:
            return ast.literal_eval(s)
        except (SyntaxError, ValueError):
            return None


# ---------------------------------------------------------------------------
# Rendering (Kairo -> XML shape)
# ---------------------------------------------------------------------------

def render_tool_result(result: ToolResult) -> str:
    """Render a ToolResult as a XML ``<tool_response>`` block."""
    body = {
        "name": result.name,
        "ok": result.ok,
        "content": result.content,
    }
    if result.error:
        body["error"] = result.error
    return f"{_TOOL_RESULT_OPEN}\n{json.dumps(body, default=str)}\n{_TOOL_RESULT_CLOSE}"


def render_tool_specs_as_xml(tools: list[ToolSpec]) -> str:
    """Render tool descriptions in the XML tool-call format."""
    lines = ["<tools>"]
    for t in tools:
        lines.append("  <function>")
        lines.append(f"    <name>{t.name}</name>")
        lines.append(f"    <description>{_escape(t.description)}</description>")
        lines.append(f"    <parameters>{_escape(json.dumps(t.parameters))}</parameters>")
        lines.append("  </function>")
    lines.append("</tools>")
    return "\n".join(lines)


def _escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def render_messages_for_hermes(
    messages: list[Message],
    tools: list[ToolSpec] | None,
) -> list[dict[str, Any]]:
    """Translate Kairo messages into OpenAI-ish dicts but with XML
    tool-call conventions for tool calls / tool results.

      * Assistant tool_calls are flattened into the text content as
        ``<tool_call>{...}</tool_call>`` because local open-weight models emit
        them that way and expect to see them that way in history.
      * Tool results become a ``user`` message containing a
        ``<tool_response>`` block.
      * If tools are present, an extra ``system`` block describing them
        is prepended (the XML tool-call system prompt).
    """
    out: list[dict[str, Any]] = []
    if tools:
        out.append({
            "role": "system",
            "content": (
                "You are a helpful assistant with access to tools. To call a tool, "
                "emit a <tool_call>{...}</tool_call> block containing a JSON object "
                'with "name" and "arguments". Wait for the <tool_response> before '
                "proceeding.\n\n" + render_tool_specs_as_xml(tools)
            ),
        })
    for m in messages:
        if m.role == Role.TOOL and m.tool_result is not None:
            out.append({"role": "user", "content": render_tool_result(m.tool_result)})
            continue
        if m.role == Role.ASSISTANT and m.tool_calls:
            text_parts: list[str] = []
            if m.content:
                text_parts.append(m.content)
            for tc in m.tool_calls:
                text_parts.append(
                    f'<tool_call>\n{json.dumps({"name": tc.name, "arguments": tc.arguments})}\n</tool_call>'
                )
            out.append({"role": "assistant", "content": "\n".join(text_parts)})
            continue
        out.append(_msg_to_openai(m))
    return out


# ---------------------------------------------------------------------------
# Provider class
# ---------------------------------------------------------------------------

@register_provider("hermes_xml")
class XMLToolCallProvider(OpenAIProvider):
    """Provider for local XML tool-call models via OpenAI-compatible API.

    This is a thin extension of :class:`OpenAIProvider` that:
      1. Re-renders messages with XML tool-call conventions before sending.
      2. Parses the response text for ``<tool_call>`` blocks instead of
         relying on the provider's ``tool_calls`` field.

    It works against any OpenAI-compatible local server (vLLM, LM Studio,
    llama.cpp server) hosting a XML tool-call or similar model.
    """

    name = "hermes_xml"

    def _complete(self, *, messages, tools, model, temperature, max_tokens, **kwargs):
        hermes_msgs = render_messages_for_hermes(messages, tools)
        body: dict[str, Any] = {
            "model": model,
            "messages": hermes_msgs,
            "temperature": temperature,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        body.update(kwargs)

        url = f"{self._base_url().rstrip('/')}/chat/completions"
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

        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {}) or {}
        content = msg.get("content") or ""
        # First try provider-side tool_calls (some servers populate both).
        calls = _parse_tool_calls(msg.get("tool_calls") or [])
        parse_err: str | None = None
        if not calls:
            calls, parse_err = extract_tool_calls(content)
        if parse_err:
            log.warning("hermes_xml parse issues: %s", parse_err)
        return ProviderResponse(
            content=content,
            tool_calls=calls,
            usage=data.get("usage"),
            model=data.get("model"),
            finish_reason=choice.get("finish_reason") or ("tool_calls" if calls else "stop"),
            raw=data,
        )
