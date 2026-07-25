"""Tests for kairo.agent.memory — persistence + run analysis."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kairo.agent.memory import SessionStore, analyze_run
from kairo.types import (
    AgentResult,
    AgentTurn,
    Message,
    ProviderResponse,
    Role,
    ToolCall,
    ToolResult,
)


def _make_result(finish="complete", turns=None, error=None) -> AgentResult:
    return AgentResult(
        messages=[Message(role=Role.USER, content="hi"),
                  Message(role=Role.ASSISTANT, content="hello")],
        turns=turns or [],
        finish_reason=finish,
        total_tokens=10,
        total_cost_usd=0.001,
        total_duration_s=0.5,
        error=error,
    )


def test_session_store_save_and_load(tmp_path: Path):
    store = SessionStore(tmp_path)
    result = _make_result()
    path = store.save(result, tag="test")
    assert path.exists()
    data = store.load(path)
    assert data["finish_reason"] == "complete"
    assert data["tag"] == "test"
    assert len(data["messages"]) == 2


def test_session_store_list_runs(tmp_path: Path):
    store = SessionStore(tmp_path)
    store.save(_make_result(), tag="a")
    store.save(_make_result(), tag="b")
    runs = store.list_runs()
    assert len(runs) == 2


def test_session_store_load_messages_round_trip(tmp_path: Path):
    store = SessionStore(tmp_path)
    tc = ToolCall(name="read_file", arguments={"path": "x"})
    tr = ToolResult(call_id=tc.id, name="read_file", ok=True, content="data")
    msgs = [
        Message(role=Role.USER, content="hi"),
        Message(role=Role.ASSISTANT, content="thinking", tool_calls=[tc]),
        Message(role=Role.TOOL, tool_result=tr),
        Message(role=Role.ASSISTANT, content="done"),
    ]
    result = AgentResult(
        messages=msgs, turns=[], finish_reason="complete",
        total_tokens=0, total_cost_usd=0, total_duration_s=0, error=None,
    )
    path = store.save(result, tag="rt")
    loaded = store.load_messages(path)
    assert len(loaded) == 4
    assert loaded[0].role == Role.USER
    assert loaded[1].tool_calls[0].name == "read_file"
    assert loaded[2].tool_result.ok is True
    assert loaded[2].tool_result.content == "data"
    assert loaded[3].content == "done"


def test_analyze_run_healthy():
    result = _make_result(finish="complete", turns=[])
    a = analyze_run(result)
    assert a["health"] == "healthy"
    assert a["finish_reason"] == "complete"


def test_analyze_run_failed_loop_limit():
    result = _make_result(finish="loop_limit", error="hit max_turns=10")
    a = analyze_run(result)
    assert a["health"] == "failed"


def test_analyze_run_counts_tool_errors():
    tr_ok = ToolResult(call_id="c1", name="read_file", ok=True, content="data")
    tr_guard = ToolResult(call_id="c2", name="read_file", ok=False, content=None,
                          error="GUARDRAIL [repeat_in_turn]: ...")
    tr_real_err = ToolResult(call_id="c2b", name="read_file", ok=False, content=None,
                             error="FileNotFoundError: /nope")
    tr_unknown = ToolResult(call_id="c3", name="bogus", ok=False, content=None,
                            error="Tool not registered: bogus")
    turn = AgentTurn(
        index=0,
        request_messages=[],
        response=ProviderResponse(content="x", tool_calls=[]),
        tool_results=[tr_ok, tr_guard, tr_real_err, tr_unknown],
    )
    result = _make_result(turns=[turn])
    a = analyze_run(result)
    assert a["tool_stats"]["read_file"]["ok"] == 1
    assert a["tool_stats"]["read_file"]["err"] == 1   # only the real error
    assert a["tool_stats"]["read_file"]["blocked"] == 1  # guardrail separate
    assert a["guardrail_blocks"] == 1
    assert a["unknown_tool_calls"] == 1
    assert a["health"] == "degraded"
