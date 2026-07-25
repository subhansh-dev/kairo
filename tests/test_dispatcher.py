"""Tests for kairo.agent.dispatcher — tool execution + guardrails."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.agent.dispatcher import ToolDispatcher
from kairo.tools import ToolBundleConfig, build_default_registry
from kairo.tools.guardrails import SpamGuard, SpamGuardConfig
from kairo.types import ToolCall


def _build_dispatcher(root: Path) -> ToolDispatcher:
    cfg = ToolBundleConfig(workspace=root)
    registry, guard, _ = build_default_registry(cfg)
    return ToolDispatcher(registry, guard)


def test_dispatch_no_calls():
    d = _build_dispatcher(Path("/tmp"))
    res = d.dispatch([])
    assert res.results == []
    assert res.blocked == []


def test_dispatch_unknown_tool_returns_error_result(tmp_workspace):
    d = _build_dispatcher(tmp_workspace)
    call = ToolCall(name="not_a_tool", arguments={})
    res = d.dispatch([call])
    assert len(res.results) == 1
    r = res.results[0]
    assert r.ok is False
    assert "not registered" in (r.error or "").lower() or "not found" in (r.error or "").lower()


def test_dispatch_read_file_success(tmp_workspace):
    (tmp_workspace / "hello.txt").write_text("hi there")
    d = _build_dispatcher(tmp_workspace)
    call = ToolCall(name="read_file", arguments={"path": "hello.txt"})
    res = d.dispatch([call])
    assert len(res.results) == 1
    r = res.results[0]
    assert r.ok is True
    assert "hi there" in r.content


def test_dispatch_blocked_repeat_returns_error(tmp_workspace):
    (tmp_workspace / "hello.txt").write_text("hi there")
    d = _build_dispatcher(tmp_workspace)
    # Override the spam guard to be strict for this test.
    from kairo.tools.guardrails import SpamGuardConfig
    d.guard.cfg = SpamGuardConfig(max_repeat_per_turn=1, max_repeat_across_turns=10)
    c1 = ToolCall(name="read_file", arguments={"path": "hello.txt"})
    c2 = ToolCall(name="read_file", arguments={"path": "hello.txt"})
    d.guard.begin_turn()
    res = d.dispatch([c1, c2])
    # One allowed, one blocked.
    oks = [r for r in res.results if r.ok]
    errs = [r for r in res.results if not r.ok]
    assert len(oks) == 1
    assert len(errs) == 1
    assert "repeat_in_turn" in (errs[0].error or "")


def test_dispatch_parallel_calls_run(tmp_workspace):
    (tmp_workspace / "a.txt").write_text("a")
    (tmp_workspace / "b.txt").write_text("b")
    d = _build_dispatcher(tmp_workspace)
    c1 = ToolCall(name="read_file", arguments={"path": "a.txt"})
    c2 = ToolCall(name="read_file", arguments={"path": "b.txt"})
    d.guard.begin_turn()
    res = d.dispatch([c1, c2])
    assert len(res.results) == 2
    contents = sorted([r.content for r in res.results if r.ok])
    # Each content has the file path + cat -n format; check substring.
    joined = "\n".join(contents)
    assert "a" in joined
    assert "b" in joined
