"""Tests for kairo.types."""

from __future__ import annotations

import json

from kairo.types import (
    Message,
    Role,
    ToolCall,
    ToolResult,
    ToolSpec,
)


def test_tool_call_fingerprint_stable():
    a = ToolCall(name="read_file", arguments={"path": "foo.py"})
    b = ToolCall(name="read_file", arguments={"path": "foo.py"})
    c = ToolCall(name="read_file", arguments={"path": "bar.py"})
    assert a.fingerprint() == b.fingerprint()
    assert a.fingerprint() != c.fingerprint()


def test_tool_call_fingerprint_arg_order_independent():
    a = ToolCall(name="x", arguments={"a": 1, "b": 2})
    b = ToolCall(name="x", arguments={"b": 2, "a": 1})
    assert a.fingerprint() == b.fingerprint()


def test_tool_result_to_message_payload_round_trip():
    r = ToolResult(call_id="c1", name="read_file", ok=True, content="hello")
    p = r.to_message_payload()
    assert p["call_id"] == "c1"
    assert p["ok"] is True
    assert p["content"] == "hello"


def test_message_to_dict_includes_tool_calls():
    tc = ToolCall(name="read_file", arguments={"path": "x"})
    m = Message(role=Role.ASSISTANT, content="hi", tool_calls=[tc])
    d = m.to_dict()
    assert d["role"] == "assistant"
    assert d["content"] == "hi"
    assert d["tool_calls"][0]["name"] == "read_file"


def test_message_to_dict_with_tool_result():
    r = ToolResult(call_id="c1", name="read_file", ok=True, content="data")
    m = Message(role=Role.TOOL, tool_result=r)
    d = m.to_dict()
    assert d["tool_result"]["call_id"] == "c1"
    assert d["tool_result"]["content"] == "data"


def test_tool_spec_defaults():
    s = ToolSpec(name="x", description="d", parameters={})
    assert s.tags == ()
    assert s.max_calls_per_run is None
