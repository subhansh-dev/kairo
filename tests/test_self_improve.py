"""Tests for kairo.agent.self_improve."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kairo.agent.memory import SessionStore
from kairo.agent.self_improve import (
    Suggestion,
    SuggestionKind,
    analyze_runs,
    format_suggestions,
)
from kairo.types import (
    AgentResult,
    AgentTurn,
    Message,
    ProviderResponse,
    Role,
    ToolResult,
)


def _save_run(store: SessionStore, *, finish="complete", tokens=100,
              tool_results=None, guardrail_blocks=0, unknown=0) -> Path:
    turns = []
    if tool_results:
        turns.append(AgentTurn(
            index=0,
            request_messages=[],
            response=ProviderResponse(content="x", tool_calls=[]),
            tool_results=tool_results,
        ))
    result = AgentResult(
        messages=[Message(role=Role.USER, content="hi"),
                  Message(role=Role.ASSISTANT, content="done")],
        turns=turns,
        finish_reason=finish,
        total_tokens=tokens,
        total_cost_usd=0.001,
        total_duration_s=0.5,
        error=None,
    )
    return store.save(result, tag=finish)


def test_analyze_runs_empty_workdir(tmp_path: Path):
    out = analyze_runs(tmp_path, limit=10)
    assert out == []


def test_analyze_runs_no_issues(tmp_path: Path):
    store = SessionStore(tmp_path)
    for _ in range(5):
        _save_run(store, finish="complete", tokens=100)
    out = analyze_runs(tmp_path, limit=10)
    # Healthy runs should produce few or no suggestions.
    assert isinstance(out, list)


def test_analyze_runs_flags_loop_limits(tmp_path: Path):
    store = SessionStore(tmp_path)
    for _ in range(3):
        _save_run(store, finish="loop_limit", tokens=5000)
    out = analyze_runs(tmp_path, limit=10)
    kinds = [s.kind for s in out]
    assert SuggestionKind.ROUTER_OVERRIDE in kinds


def test_analyze_runs_flags_tool_error_rate(tmp_path: Path):
    store = SessionStore(tmp_path)
    # 5 runs, each with 1 ok + 5 real err for read_file = ~83% error rate.
    # Guardrail errors don't count toward error rate.
    for _ in range(5):
        _save_run(store, tool_results=[
            ToolResult(call_id="1", name="read_file", ok=True, content="x"),
            ToolResult(call_id="2", name="read_file", ok=False, content=None, error="FileNotFoundError"),
            ToolResult(call_id="3", name="read_file", ok=False, content=None, error="FileNotFoundError"),
            ToolResult(call_id="4", name="read_file", ok=False, content=None, error="FileNotFoundError"),
            ToolResult(call_id="5", name="read_file", ok=False, content=None, error="FileNotFoundError"),
            ToolResult(call_id="6", name="read_file", ok=False, content=None, error="FileNotFoundError"),
        ])
    out = analyze_runs(tmp_path, limit=10)
    titles = [s.title for s in out]
    assert any("read_file" in t and "error rate" in t for t in titles)


def test_guardrail_blocks_do_not_count_as_tool_errors(tmp_path: Path):
    """Guardrail-blocked calls must NOT inflate the tool's error rate."""
    store = SessionStore(tmp_path)
    for _ in range(5):
        tool_results = [
            ToolResult(call_id="1", name="read_file", ok=True, content="x"),
        ]
        # 5 guardrail-blocked calls — these should NOT count as errors.
        for i in range(5):
            tool_results.append(ToolResult(
                call_id=f"g{i}", name="read_file", ok=False, content=None,
                error="GUARDRAIL [repeat_in_turn]: ...",
            ))
        _save_run(store, tool_results=tool_results)
    out = analyze_runs(tmp_path, limit=10)
    # No tool-description suggestion should fire (real error rate is 0%).
    titles = [s.title for s in out]
    assert not any("read_file" in t and "error rate" in t for t in titles)


def test_analyze_runs_flags_guardrail_pressure(tmp_path: Path):
    store = SessionStore(tmp_path)
    # 5 runs, each with 5 guardrail blocks.
    for _ in range(5):
        _save_run(store, guardrail_blocks=5, tool_results=[
            ToolResult(call_id="1", name="x", ok=False, content=None,
                       error="GUARDRAIL [repeat_in_turn]: ..."),
        ] * 5)
    out = analyze_runs(tmp_path, limit=10)
    kinds = [s.kind for s in out]
    assert SuggestionKind.SPAM_GUARD_LOOSEN in kinds


def test_format_suggestions_empty():
    s = format_suggestions([])
    assert "No improvement" in s or "healthy" in s


def test_format_suggestions_with_items():
    sugs = [
        Suggestion(
            kind=SuggestionKind.ROUTER_OVERRIDE,
            title="T1",
            detail="D1",
            confidence=0.9,
            evidence=["/tmp/x.json"],
        ),
    ]
    s = format_suggestions(sugs)
    assert "T1" in s
    assert "D1" in s
    assert "90%" in s
