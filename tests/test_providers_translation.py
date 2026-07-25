"""Tests for kairo.providers — translation logic, no network calls."""

from __future__ import annotations

import json

from kairo.providers.anthropic import _msg_to_anthropic, _parse_blocks, _spec_to_anthropic
from kairo.providers.openai import _msg_to_openai, _parse_tool_calls, _spec_to_openai
from kairo.providers.hermes_xml import (
    extract_tool_calls,
    render_tool_specs_as_xml,
    render_tool_result,
    render_messages_for_hermes,
)
from kairo.types import Message, Role, ToolCall, ToolResult, ToolSpec


# ---------------------------------------------------------------------------
# OpenAI translation
# ---------------------------------------------------------------------------

def test_openai_msg_user():
    m = Message(role=Role.USER, content="hi")
    d = _msg_to_openai(m)
    assert d == {"role": "user", "content": "hi"}


def test_openai_msg_assistant_with_tool_calls():
    tc = ToolCall(name="read_file", arguments={"path": "x"})
    m = Message(role=Role.ASSISTANT, content="thinking", tool_calls=[tc])
    d = _msg_to_openai(m)
    assert d["role"] == "assistant"
    assert d["content"] == "thinking"
    assert d["tool_calls"][0]["function"]["name"] == "read_file"
    assert json.loads(d["tool_calls"][0]["function"]["arguments"]) == {"path": "x"}


def test_openai_msg_tool_result():
    r = ToolResult(call_id="c1", name="read_file", ok=True, content="data")
    m = Message(role=Role.TOOL, tool_result=r)
    d = _msg_to_openai(m)
    assert d["role"] == "tool"
    assert d["tool_call_id"] == "c1"
    assert d["content"] == "data"


def test_openai_parse_tool_calls():
    raw = [
        {"id": "1", "type": "function",
         "function": {"name": "x", "arguments": '{"a": 1}'}},
        {"id": "2", "type": "function",
         "function": {"name": "y", "arguments": '{"b": 2}'}},
    ]
    calls = _parse_tool_calls(raw)
    assert len(calls) == 2
    assert calls[0].name == "x"
    assert calls[0].arguments == {"a": 1}
    assert calls[0].provider_id == "1"


def test_openai_parse_tool_calls_invalid_json_kept_raw():
    raw = [{"id": "1", "type": "function",
            "function": {"name": "x", "arguments": "not json"}}]
    calls = _parse_tool_calls(raw)
    assert len(calls) == 1
    assert calls[0].arguments == {"_raw": "not json"}


def test_openai_spec_translation():
    spec = ToolSpec(name="x", description="d",
                    parameters={"type": "object", "properties": {}})
    d = _spec_to_openai(spec)
    assert d["type"] == "function"
    assert d["function"]["name"] == "x"


# ---------------------------------------------------------------------------
# Anthropic translation
# ---------------------------------------------------------------------------

def test_anthropic_assistant_with_tool_calls():
    tc = ToolCall(name="x", arguments={"a": 1}, provider_id="t1")
    m = Message(role=Role.ASSISTANT, content="hi", tool_calls=[tc])
    role, content = _msg_to_anthropic(m)
    assert role == "assistant"
    assert isinstance(content, list)
    assert content[0] == {"type": "text", "text": "hi"}
    assert content[1]["type"] == "tool_use"
    assert content[1]["name"] == "x"
    assert content[1]["input"] == {"a": 1}


def test_anthropic_tool_result_block():
    r = ToolResult(call_id="c1", name="x", ok=True, content="data")
    m = Message(role=Role.TOOL, tool_result=r)
    role, content = _msg_to_anthropic(m)
    assert role == "user"
    assert content[0]["type"] == "tool_result"
    assert content[0]["tool_use_id"] == "c1"
    assert content[0]["content"] == "data"


def test_anthropic_parse_blocks_text_and_tool_use():
    blocks = [
        {"type": "text", "text": "thinking..."},
        {"type": "tool_use", "id": "t1", "name": "x", "input": {"a": 1}},
    ]
    content, calls = _parse_blocks(blocks)
    assert "thinking" in content
    assert len(calls) == 1
    assert calls[0].name == "x"
    assert calls[0].arguments == {"a": 1}


def test_anthropic_spec_translation():
    spec = ToolSpec(name="x", description="d", parameters={"type": "object"})
    d = _spec_to_anthropic(spec)
    assert d["name"] == "x"
    assert d["input_schema"] == {"type": "object"}


# ---------------------------------------------------------------------------
# Hermes-XML parser
# ---------------------------------------------------------------------------

def test_hermes_extract_single_call():
    text = '<tool_call>\n{"name": "read_file", "arguments": {"path": "x"}}\n</tool_call>'
    calls, err = extract_tool_calls(text)
    assert err is None
    assert len(calls) == 1
    assert calls[0].name == "read_file"
    assert calls[0].arguments == {"path": "x"}


def test_hermes_extract_multiple_calls():
    text = """I'll do two things.
<tool_call>
{"name": "a", "arguments": {}}
</tool_call>
and then
<tool_call>
{"name": "b", "arguments": {}}
</tool_call>
"""
    calls, err = extract_tool_calls(text)
    assert err is None
    assert len(calls) == 2
    assert {c.name for c in calls} == {"a", "b"}


def test_hermes_extract_python_literal_fallback():
    # Hermes models sometimes emit single-quoted dicts.
    text = "<tool_call>\n{'name': 'x', 'arguments': {'a': 1}}\n</tool_call>"
    calls, err = extract_tool_calls(text)
    assert err is None
    assert len(calls) == 1
    assert calls[0].name == "x"
    assert calls[0].arguments == {"a": 1}


def test_hermes_extract_markdown_fenced_json():
    text = """Sure.
```json
{"name": "x", "arguments": {}}
```
"""
    calls, err = extract_tool_calls(text)
    # The fenced block alone (without <tool_call>) won't be picked up by
    # the XML parser, so we expect zero calls and no error.
    assert calls == []


def test_hermes_extract_no_calls_returns_empty():
    text = "Just a regular response, no tool calls."
    calls, err = extract_tool_calls(text)
    assert calls == []
    assert err is None


def test_hermes_render_tool_specs_xml():
    specs = [ToolSpec(name="x", description="do x", parameters={"type": "object"})]
    xml = render_tool_specs_as_xml(specs)
    assert "<tools>" in xml
    assert "<name>x</name>" in xml
    assert "<description>do x</description>" in xml


def test_hermes_render_tool_result():
    r = ToolResult(call_id="c1", name="x", ok=True, content={"a": 1})
    s = render_tool_result(r)
    assert "<tool_response>" in s
    assert "</tool_response>" in s
    assert '"name": "x"' in s


def test_hermes_render_messages_for_hermes_injects_system_prompt():
    msgs = [Message(role=Role.USER, content="hi")]
    tools = [ToolSpec(name="x", description="d", parameters={"type": "object"})]
    out = render_messages_for_hermes(msgs, tools)
    assert out[0]["role"] == "system"
    assert "<tools>" in out[0]["content"]
    assert out[1] == {"role": "user", "content": "hi"}


def test_hermes_render_messages_for_hermes_assistant_tool_call():
    tc = ToolCall(name="x", arguments={"a": 1})
    msgs = [Message(role=Role.ASSISTANT, content="thinking", tool_calls=[tc])]
    out = render_messages_for_hermes(msgs, None)
    assert out[0]["role"] == "assistant"
    assert "<tool_call>" in out[0]["content"]
    assert '"name": "x"' in out[0]["content"]


def test_hermes_render_messages_for_hermes_tool_result():
    r = ToolResult(call_id="c1", name="x", ok=True, content="data")
    msgs = [Message(role=Role.TOOL, tool_result=r)]
    out = render_messages_for_hermes(msgs, None)
    assert out[0]["role"] == "user"
    assert "<tool_response>" in out[0]["content"]
