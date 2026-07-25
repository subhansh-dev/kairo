"""Tests for kairo.tools.introspection — agent self-awareness tools."""

from __future__ import annotations

import json
from typing import Any

import pytest

from kairo.tools.base import ToolRegistry, register_all
from kairo.tools.introspection import (
    make_introspection_tools,
    register_introspection_tools,
)


def _make_registry(state: dict[str, Any]) -> ToolRegistry:
    reg = ToolRegistry()
    register_introspection_tools(reg, lambda: state)
    return reg


def test_self_status_returns_json():
    state = {
        "turns_used": 3, "max_turns": 10,
        "tokens_used": 1500, "cost_usd": 0.05,
        "tools_available": [{"name": "read_file", "description": "Read a file"}],
        "message_count": 7, "phase": "executor",
        "model": "glm-4.6", "provider": "glm",
    }
    reg = _make_registry(state)
    out = reg.get("self_status").fn()
    data = json.loads(out)
    assert data["turns_used"] == 3
    assert data["max_turns"] == 10
    assert data["tokens_used"] == 1500
    assert data["tool_count"] == 1
    assert data["phase"] == "executor"
    assert data["model"] == "glm-4.6"


def test_self_status_empty_state():
    reg = _make_registry({})
    out = reg.get("self_status").fn()
    data = json.loads(out)
    assert data["turns_used"] == 0
    assert data["tool_count"] == 0


def test_self_tools_lists_tools():
    state = {
        "tools_available": [
            {"name": "read_file", "description": "Read a file from disk.\nMore details."},
            {"name": "write_file", "description": "Write content to a file."},
        ]
    }
    reg = _make_registry(state)
    out = reg.get("self_tools").fn()
    assert "read_file" in out
    assert "write_file" in out
    # Should only include the first line of the description.
    assert "Read a file from disk." in out
    assert "More details" not in out


def test_self_tools_empty():
    reg = _make_registry({})
    out = reg.get("self_tools").fn()
    assert "no tools" in out.lower()


def test_self_history_returns_messages():
    state = {
        "messages": [
            {"role": "system", "content": "You are a helpful agent."},
            {"role": "user", "content": "Fix the bug"},
            {"role": "assistant", "content": "Let me read the file.", "tool_calls": [{"name": "read_file"}]},
            {"role": "tool", "content": "file contents", "tool_result": {"name": "read_file"}},
            {"role": "assistant", "content": "The bug is on line 5."},
        ]
    }
    reg = _make_registry(state)
    out = reg.get("self_history").fn()
    assert "[system]" in out
    assert "[user]" in out
    assert "[assistant]" in out
    assert "[tool]" in out
    assert "tool_calls: 1" in out
    assert "tool_result: read_file" in out


def test_self_history_respects_last_n():
    state = {
        "messages": [
            {"role": "user", "content": "msg 1"},
            {"role": "assistant", "content": "msg 2"},
            {"role": "user", "content": "msg 3"},
            {"role": "assistant", "content": "msg 4"},
            {"role": "user", "content": "msg 5"},
        ]
    }
    reg = _make_registry(state)
    out = reg.get("self_history").fn(last_n=2)
    # Should only have the last 2 messages.
    assert "msg 4" in out
    assert "msg 5" in out
    assert "msg 1" not in out


def test_self_history_truncates_long_content():
    state = {
        "messages": [
            {"role": "user", "content": "x" * 200},
        ]
    }
    reg = _make_registry(state)
    out = reg.get("self_history").fn()
    # Should be truncated to 100 chars + "...".
    assert "..." in out
    assert "x" * 200 not in out


def test_self_history_empty():
    reg = _make_registry({})
    out = reg.get("self_history").fn()
    assert "no messages" in out.lower()


def test_self_budget_with_limits():
    state = {
        "turns_used": 3, "max_turns": 10,
        "tokens_used": 1500, "max_tokens": 10000,
        "cost_usd": 0.05, "max_cost_usd": 1.0,
    }
    reg = _make_registry(state)
    out = reg.get("self_budget").fn()
    data = json.loads(out)
    assert data["turns_remaining"] == 7
    assert data["tokens_remaining"] == 8500
    assert data["cost_remaining_usd"] == 0.95
    assert data["exhausted"] is False


def test_self_budget_without_limits():
    state = {"turns_used": 3, "tokens_used": 1500, "cost_usd": 0.05}
    reg = _make_registry(state)
    out = reg.get("self_budget").fn()
    data = json.loads(out)
    assert data["turns_remaining"] is None
    assert data["tokens_remaining"] is None
    assert data["cost_remaining_usd"] is None
    assert data["exhausted"] is False


def test_self_budget_exhausted():
    state = {
        "turns_used": 10, "max_turns": 10,
        "tokens_used": 0, "cost_usd": 0.0,
    }
    reg = _make_registry(state)
    out = reg.get("self_budget").fn()
    data = json.loads(out)
    assert data["exhausted"] is True
