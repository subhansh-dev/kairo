"""Streaming provider support.

Most providers expose a `/chat/completions` endpoint with `stream: true`
that returns Server-Sent Events. This module provides:

  * :class:`StreamEvent` — a typed union over the events we emit.
  * :func:`stream_openai_compat` — a generic SSE parser for any
    OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama, GLM,
    vLLM-hosted Hermes models).
  * :func:`stream_anthropic` — a parser for Anthropic's streaming format.

The agent loop doesn't require streaming — it uses non-streaming
:class:`ProviderResponse` calls. Streaming is exposed purely for the
REPL/CLI so users can see tokens as they arrive.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Iterator, Literal

import httpx

from kairo.config import ProviderConfig
from kairo.errors import ProviderError, ProviderUnavailable
from kairo.types import Message, ProviderName, ToolCall
from kairo.utils import get_logger

log = get_logger("provider.streaming")


EventKind = Literal[
    "text_delta",       # a chunk of assistant text
    "tool_call_start",  # beginning of a tool call (name known)
    "tool_call_args",   # a chunk of tool-call arguments JSON
    "tool_call_end",    # a tool call is complete
    "done",             # stream finished
    "error",            # stream errored
]


@dataclass(slots=True)
class StreamEvent:
    kind: EventKind
    # For text_delta: the text chunk.
    # For tool_call_start: the tool name.
    # For tool_call_args: the args JSON chunk.
    # For tool_call_end: the parsed arguments dict.
    # For done: the finish_reason string.
    # For error: the error message.
    data: Any = None
    # Tool-call index (0-based) for tool_call_* events.
    index: int | None = None
    # Optional usage dict emitted at done.
    usage: dict[str, int] | None = None


# ---------------------------------------------------------------------------
# OpenAI-compatible SSE parser
# ---------------------------------------------------------------------------

def stream_openai_compat(
    *,
    base_url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    timeout: float = 120.0,
) -> Iterator[StreamEvent]:
    """Stream from an OpenAI-compatible /chat/completions endpoint.

    Yields :class:`StreamEvent` objects. The caller is responsible for
    assembling text deltas and tool-call argument chunks into final
    objects — see :func:`assemble_stream` for a helper.
    """
    url = f"{base_url.rstrip('/')}/chat/completions"
    body = {**body, "stream": True}
    try:
        with httpx.Client(timeout=timeout, headers=headers) as client:
            with client.stream("POST", url, json=body) as resp:
                if resp.status_code >= 400:
                    text = resp.read().decode("utf-8", errors="replace")
                    yield StreamEvent(kind="error", data=f"HTTP {resp.status_code}: {text[:500]}")
                    return
                for line in resp.iter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        payload = line[6:].strip()
                    elif line.startswith("data:"):
                        payload = line[5:].strip()
                    else:
                        continue
                    if payload == "[DONE]":
                        yield StreamEvent(kind="done", data="stop")
                        return
                    try:
                        data = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    for ev in _parse_openai_chunk(data):
                        yield ev
    except httpx.HTTPError as exc:
        yield StreamEvent(kind="error", data=str(exc))
        return


def _parse_openai_chunk(data: dict) -> Iterator[StreamEvent]:
    choices = data.get("choices") or []
    if not choices:
        return
    choice = choices[0]
    delta = choice.get("delta") or {}
    finish = choice.get("finish_reason")
    # Text delta.
    if "content" in delta and delta["content"]:
        yield StreamEvent(kind="text_delta", data=delta["content"])
    # Tool-call deltas.
    for tc in delta.get("tool_calls") or []:
        idx = tc.get("index", 0)
        fn = tc.get("function") or {}
        if fn.get("name"):
            yield StreamEvent(kind="tool_call_start", data=fn["name"], index=idx)
        if fn.get("arguments"):
            yield StreamEvent(kind="tool_call_args", data=fn["arguments"], index=idx)
    if finish:
        yield StreamEvent(kind="done", data=finish, usage=data.get("usage"))


# ---------------------------------------------------------------------------
# Anthropic SSE parser
# ---------------------------------------------------------------------------

def stream_anthropic(
    *,
    base_url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    timeout: float = 120.0,
) -> Iterator[StreamEvent]:
    """Stream from Anthropic's /v1/messages endpoint."""
    url = f"{base_url.rstrip('/')}/v1/messages"
    body = {**body, "stream": True}
    try:
        with httpx.Client(timeout=timeout, headers=headers) as client:
            with client.stream("POST", url, json=body) as resp:
                if resp.status_code >= 400:
                    text = resp.read().decode("utf-8", errors="replace")
                    yield StreamEvent(kind="error", data=f"HTTP {resp.status_code}: {text[:500]}")
                    return
                for line in resp.iter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    try:
                        data = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    for ev in _parse_anthropic_event(data):
                        yield ev
                    if data.get("type") == "message_stop":
                        yield StreamEvent(kind="done", data="stop")
                        return
    except httpx.HTTPError as exc:
        yield StreamEvent(kind="error", data=str(exc))
        return


def _parse_anthropic_event(data: dict) -> Iterator[StreamEvent]:
    t = data.get("type")
    if t == "content_block_start":
        block = data.get("content_block") or {}
        if block.get("type") == "tool_use":
            yield StreamEvent(kind="tool_call_start",
                              data=block.get("name", ""),
                              index=data.get("index", 0))
    elif t == "content_block_delta":
        delta = data.get("delta") or {}
        if delta.get("type") == "text_delta":
            yield StreamEvent(kind="text_delta", data=delta.get("text", ""))
        elif delta.get("type") == "input_json_delta":
            yield StreamEvent(kind="tool_call_args",
                              data=delta.get("partial_json", ""),
                              index=data.get("index", 0))
    elif t == "content_block_stop":
        yield StreamEvent(kind="tool_call_end", index=data.get("index", 0))
    elif t == "message_delta":
        delta = data.get("delta") or {}
        if delta.get("stop_reason"):
            yield StreamEvent(kind="done", data=delta["stop_reason"],
                              usage=data.get("usage"))


# ---------------------------------------------------------------------------
# Assembler — turn a stream into a final ProviderResponse-like dict
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class AssembledStream:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str | None = None
    usage: dict[str, int] | None = None
    error: str | None = None


def assemble_stream(events: Iterator[StreamEvent]) -> AssembledStream:
    """Consume a stream of events into a single AssembledStream.

    Used by callers that want streaming UX but also need the final
    structured response for the agent loop.
    """
    out = AssembledStream()
    # Per-index accumulators for tool calls.
    tc_args: dict[int, str] = {}
    tc_names: dict[int, str] = {}
    tc_indices: list[int] = []  # to preserve order

    for ev in events:
        if ev.kind == "text_delta":
            out.text += ev.data or ""
        elif ev.kind == "tool_call_start":
            idx = ev.index or 0
            if idx not in tc_indices:
                tc_indices.append(idx)
            tc_names[idx] = ev.data or ""
            tc_args.setdefault(idx, "")
        elif ev.kind == "tool_call_args":
            idx = ev.index or 0
            tc_args[idx] = tc_args.get(idx, "") + (ev.data or "")
        elif ev.kind == "tool_call_end":
            idx = ev.index or 0
            # Tool call is complete — parse args.
            raw_args = tc_args.get(idx, "")
            try:
                args = json.loads(raw_args) if raw_args else {}
            except json.JSONDecodeError:
                args = {"_raw": raw_args}
            name = tc_names.get(idx, "")
            out.tool_calls.append(ToolCall(name=name, arguments=args))
        elif ev.kind == "done":
            out.finish_reason = ev.data
            out.usage = ev.usage
        elif ev.kind == "error":
            out.error = ev.data
            break
    return out
