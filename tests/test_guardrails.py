"""Tests for kairo.tools.guardrails."""

from __future__ import annotations

import pytest

from kairo.errors import GuardrailError
from kairo.tools.guardrails import (
    SpamGuard,
    SpamGuardConfig,
    screen_calls,
    validate_arguments,
)
from kairo.types import ToolCall


def _call(name="x", **args) -> ToolCall:
    return ToolCall(name=name, arguments=args)


def test_spam_guard_allows_first_call():
    g = SpamGuard()
    g.begin_turn()
    assert g.check(_call(name="read_file", path="foo")) is None


def test_spam_guard_blocks_repeat_in_turn():
    # Use a strict config so the test is robust against default changes.
    g = SpamGuard(SpamGuardConfig(max_repeat_per_turn=1))
    g.begin_turn()
    c = _call(name="read_file", path="foo")
    assert g.check(c) is None
    err = g.check(c)
    assert err is not None
    assert err.rule == "repeat_in_turn"


def test_spam_guard_blocks_across_turns():
    g = SpamGuard(SpamGuardConfig(max_repeat_across_turns=2, across_turns_window=3))
    c = _call(name="read_file", path="foo")
    g.begin_turn()
    assert g.check(c) is None
    g.begin_turn()
    assert g.check(c) is None
    g.begin_turn()
    err = g.check(c)
    assert err is not None
    assert err.rule == "repeat_across_turns"


def test_spam_guard_per_tool_cap():
    g = SpamGuard(SpamGuardConfig(per_tool_caps={"read_file": 2}))
    g.begin_turn()
    assert g.check(_call(name="read_file", path="a")) is None
    assert g.check(_call(name="read_file", path="b")) is None
    err = g.check(_call(name="read_file", path="c"))
    assert err is not None
    assert err.rule == "per_tool_cap"


def test_spam_guard_per_turn_total_cap():
    g = SpamGuard(SpamGuardConfig(max_calls_per_turn=2, max_repeat_per_turn=10))
    g.begin_turn()
    assert g.check(_call(name="a")) is None
    assert g.check(_call(name="b")) is None
    err = g.check(_call(name="c"))
    assert err is not None
    assert err.rule == "per_turn_cap"


def test_validate_arguments_missing_required():
    c = ToolCall(name="x", arguments={})
    schema = {"type": "object", "properties": {"a": {"type": "string"}},
              "required": ["a"]}
    err = validate_arguments(c, schema)
    assert err is not None
    assert err.rule == "missing_arg"


def test_validate_arguments_bad_type():
    c = ToolCall(name="x", arguments={"a": 1})
    schema = {"type": "object", "properties": {"a": {"type": "string"}},
              "required": ["a"]}
    err = validate_arguments(c, schema)
    assert err is not None
    assert err.rule == "bad_arg_type"


def test_validate_arguments_ok():
    c = ToolCall(name="x", arguments={"a": "ok"})
    schema = {"type": "object", "properties": {"a": {"type": "string"}},
              "required": ["a"]}
    assert validate_arguments(c, schema) is None


def test_screen_calls_returns_allowed_and_blocked():
    g = SpamGuard(SpamGuardConfig(max_repeat_per_turn=1))
    g.begin_turn()
    calls = [
        _call(name="read_file", path="a"),
        _call(name="read_file", path="a"),  # blocked (repeat in turn)
        _call(name="read_file", path="b"),  # allowed
    ]
    schemas = {"read_file": {"type": "object", "properties": {"path": {"type": "string"}}}}
    res = screen_calls(calls, g, schemas)
    assert len(res.allowed) == 2
    assert len(res.blocked) == 1
    assert res.blocked[0][1].rule == "repeat_in_turn"
