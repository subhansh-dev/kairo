"""Tests for kairo.agent.tool_grammar — small-model tool-call extraction."""

from __future__ import annotations

import pytest

from kairo.agent.tool_grammar import (
    GrammarResult,
    extract_tool_calls_grammar,
    render_tool_call_example,
    render_tools_compact,
)
from kairo.tools.base import ToolRegistry, register_all, tool


def _make_registry():
    reg = ToolRegistry()

    @tool(name="read_file")
    def read_file(path: str, offset: int = 0) -> str:
        """Read a file from disk."""
        return ""

    @tool(name="write_file")
    def write_file(path: str, content: str) -> str:
        """Write content to a file."""
        return ""

    register_all(reg, read_file, write_file)
    return reg


def test_extract_xml_tool_call_block():
    reg = _make_registry()
    text = '<tool_call>\n{"name": "read_file", "arguments": {"path": "foo.py"}}\n</tool_call>'
    result = extract_tool_calls_grammar(text, reg)
    assert len(result.calls) == 1
    assert result.calls[0].name == "read_file"
    assert result.calls[0].arguments["path"] == "foo.py"


def test_extract_markdown_fenced_block():
    reg = _make_registry()
    text = '```json\n{"name": "write_file", "arguments": {"path": "x", "content": "y"}}\n```'
    result = extract_tool_calls_grammar(text, reg)
    assert len(result.calls) == 1
    assert result.calls[0].name == "write_file"


def test_extract_multiple_blocks():
    reg = _make_registry()
    text = """I'll do two things:
<tool_call>
{"name": "read_file", "arguments": {"path": "a"}}
</tool_call>
and then
<tool_call>
{"name": "read_file", "arguments": {"path": "b"}}
</tool_call>
"""
    result = extract_tool_calls_grammar(text, reg)
    assert len(result.calls) == 2
    assert {c.arguments["path"] for c in result.calls} == {"a", "b"}


def test_extract_single_quoted_python_literal():
    reg = _make_registry()
    text = "<tool_call>\n{'name': 'read_file', 'arguments': {'path': 'x'}}\n</tool_call>"
    result = extract_tool_calls_grammar(text, reg)
    assert len(result.calls) == 1
    assert result.calls[0].arguments["path"] == "x"


def test_extract_handles_missing_arguments_key():
    reg = _make_registry()
    text = '<tool_call>\n{"name": "read_file", "path": "x"}\n</tool_call>'
    result = extract_tool_calls_grammar(text, reg)
    # Should still produce a call (path lives at top level — we don't
    # auto-promote, but the call exists with empty args).
    # Actually our parser doesn't promote top-level keys to args, so
    # arguments defaults to {}. The call is still valid.
    assert len(result.calls) >= 1
    assert result.calls[0].name == "read_file"


def test_extract_args_instead_of_arguments():
    reg = _make_registry()
    text = '<tool_call>\n{"name": "read_file", "args": {"path": "x"}}\n</tool_call>'
    result = extract_tool_calls_grammar(text, reg)
    assert len(result.calls) == 1
    assert result.calls[0].arguments["path"] == "x"


def test_extract_function_field_for_name():
    """OpenAI-style: name is inside a 'function' sub-dict."""
    reg = _make_registry()
    text = '<tool_call>\n{"function": {"name": "read_file", "arguments": {"path": "x"}}}\n</tool_call>'
    result = extract_tool_calls_grammar(text, reg)
    # We extract name from .function.name when possible.
    assert len(result.calls) >= 1
    if result.calls:
        assert result.calls[0].name == "read_file"


def test_extract_arguments_as_string():
    reg = _make_registry()
    text = '<tool_call>\n{"name": "read_file", "arguments": "{\\"path\\": \\"x\\"}"}\n</tool_call>'
    result = extract_tool_calls_grammar(text, reg)
    assert len(result.calls) == 1
    assert result.calls[0].arguments["path"] == "x"


def test_extract_unknown_tool_records_error():
    reg = _make_registry()
    text = '<tool_call>\n{"name": "bogus_tool", "arguments": {}}\n</tool_call>'
    result = extract_tool_calls_grammar(text, reg)
    # Still returns the call (so the agent loop can show the error to
    # the model), but records an error.
    assert any("unknown tool" in e for e in result.errors)


def test_extract_empty_text():
    reg = _make_registry()
    result = extract_tool_calls_grammar("", reg)
    assert result.calls == []
    assert result.errors == []


def test_extract_no_tool_calls_in_text():
    reg = _make_registry()
    result = extract_tool_calls_grammar("just a regular response, no tools", reg)
    assert result.calls == []


def test_extract_invalid_json_records_error():
    reg = _make_registry()
    text = "<tool_call>\nnot valid json at all\n</tool_call>"
    result = extract_tool_calls_grammar(text, reg)
    assert result.calls == []
    assert any("could not parse" in e for e in result.errors)


def test_render_tools_compact():
    reg = _make_registry()
    out = render_tools_compact(reg)
    assert "TOOLS:" in out
    assert "read_file" in out
    assert "write_file" in out
    # Should include parameter types.
    assert "path: string" in out
    # Descriptions are included.
    assert "Read a file" in out


def test_render_tool_call_example():
    out = render_tool_call_example("read_file", {"path": "x"})
    assert "<tool_call>" in out
    assert "</tool_call>" in out
    assert '"name": "read_file"' in out
    assert '"path": "x"' in out


def test_extract_coerces_arg_types():
    """If the model passes a string where the schema wants int, we coerce."""
    reg = _make_registry()
    text = '<tool_call>\n{"name": "read_file", "arguments": {"path": "x", "offset": "5"}}\n</tool_call>'
    result = extract_tool_calls_grammar(text, reg)
    assert len(result.calls) == 1
    # offset should be coerced from "5" to 5.
    assert result.calls[0].arguments["offset"] == 5
