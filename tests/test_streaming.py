"""Tests for kairo.providers.streaming."""

from __future__ import annotations

import json
from typing import Iterator

from kairo.providers.streaming import (
    AssembledStream,
    StreamEvent,
    _parse_anthropic_event,
    _parse_openai_chunk,
    assemble_stream,
)


def _chunk(delta: dict, finish: str | None = None, usage: dict | None = None) -> dict:
    out = {"choices": [{"delta": delta, "finish_reason": finish}]}
    if usage:
        out["usage"] = usage
    return out


def test_openai_text_delta():
    chunks = [
        _chunk({"content": "Hel"}),
        _chunk({"content": "lo"}),
        _chunk({}, finish="stop", usage={"total_tokens": 5}),
    ]
    events = [ev for c in chunks for ev in _parse_openai_chunk(c)]
    assert events[0].kind == "text_delta"
    assert events[0].data == "Hel"
    assert events[1].kind == "text_delta"
    assert events[1].data == "lo"
    assert events[2].kind == "done"
    assert events[2].data == "stop"
    assert events[2].usage == {"total_tokens": 5}


def test_openai_tool_call_delta():
    chunks = [
        _chunk({"tool_calls": [{"index": 0, "function": {"name": "read_file"}}]}),
        _chunk({"tool_calls": [{"index": 0, "function": {"arguments": '{"path":'}}]}),
        _chunk({"tool_calls": [{"index": 0, "function": {"arguments": ' "x"}'}}]}),
        _chunk({}, finish="tool_calls"),
    ]
    events = [ev for c in chunks for ev in _parse_openai_chunk(c)]
    kinds = [e.kind for e in events]
    assert "tool_call_start" in kinds
    assert kinds.count("tool_call_args") == 2


def test_openai_done_marker_yields_done():
    # "[DONE]" is handled by stream_openai_compat, not _parse_openai_chunk.
    # _parse_openai_chunk only emits done when finish_reason is set.
    events = list(_parse_openai_chunk({"choices": [{"delta": {}, "finish_reason": "stop"}]}))
    assert events[0].kind == "done"


def test_anthropic_text_delta():
    data = {"type": "content_block_delta",
            "delta": {"type": "text_delta", "text": "hi"}}
    events = list(_parse_anthropic_event(data))
    assert events[0].kind == "text_delta"
    assert events[0].data == "hi"


def test_anthropic_tool_use_start():
    data = {"type": "content_block_start", "index": 0,
            "content_block": {"type": "tool_use", "name": "x", "id": "t1"}}
    events = list(_parse_anthropic_event(data))
    assert events[0].kind == "tool_call_start"
    assert events[0].data == "x"
    assert events[0].index == 0


def test_anthropic_input_json_delta():
    data = {"type": "content_block_delta", "index": 0,
            "delta": {"type": "input_json_delta", "partial_json": '{"a":'}}
    events = list(_parse_anthropic_event(data))
    assert events[0].kind == "tool_call_args"
    assert events[0].data == '{"a":'


def test_assemble_stream_text_only():
    events = iter([
        StreamEvent(kind="text_delta", data="Hel"),
        StreamEvent(kind="text_delta", data="lo"),
        StreamEvent(kind="done", data="stop", usage={"total_tokens": 3}),
    ])
    out = assemble_stream(events)
    assert out.text == "Hello"
    assert out.tool_calls == []
    assert out.finish_reason == "stop"
    assert out.usage == {"total_tokens": 3}
    assert out.error is None


def test_assemble_stream_with_tool_call():
    events = iter([
        StreamEvent(kind="text_delta", data="thinking"),
        StreamEvent(kind="tool_call_start", data="read_file", index=0),
        StreamEvent(kind="tool_call_args", data='{"path":', index=0),
        StreamEvent(kind="tool_call_args", data=' "x"}', index=0),
        StreamEvent(kind="tool_call_end", index=0),
        StreamEvent(kind="done", data="tool_calls"),
    ])
    out = assemble_stream(events)
    assert out.text == "thinking"
    assert len(out.tool_calls) == 1
    assert out.tool_calls[0].name == "read_file"
    assert out.tool_calls[0].arguments == {"path": "x"}
    assert out.finish_reason == "tool_calls"


def test_assemble_stream_handles_invalid_json():
    events = iter([
        StreamEvent(kind="tool_call_start", data="x", index=0),
        StreamEvent(kind="tool_call_args", data="not json", index=0),
        StreamEvent(kind="tool_call_end", index=0),
        StreamEvent(kind="done", data="stop"),
    ])
    out = assemble_stream(events)
    assert len(out.tool_calls) == 1
    assert out.tool_calls[0].arguments == {"_raw": "not json"}


def test_assemble_stream_error_short_circuits():
    events = iter([
        StreamEvent(kind="text_delta", data="hi"),
        StreamEvent(kind="error", data="boom"),
        StreamEvent(kind="text_delta", data="should not see"),
    ])
    out = assemble_stream(events)
    assert out.text == "hi"
    assert out.error == "boom"
