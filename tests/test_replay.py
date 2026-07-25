"""Tests for kairo.agent.replay — step-by-step run replay."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kairo.agent.memory import SessionStore
from kairo.agent.replay import ReplayMode, ReplayPlayer
from kairo.types import (
    AgentResult,
    AgentTurn,
    Message,
    ProviderResponse,
    Role,
    ToolCall,
    ToolResult,
)
from kairo.tools.base import ToolRegistry, register_all, tool


def _save_run(store: SessionStore, *, finish="complete") -> Path:
    tc = ToolCall(name="echo", arguments={"text": "hi"}, id="call_1")
    tr = ToolResult(call_id="call_1", name="echo", ok=True, content="hi")
    turn = AgentTurn(
        index=0,
        request_messages=[Message(role=Role.USER, content="echo hi")],
        response=ProviderResponse(content="I'll echo that.", tool_calls=[tc]),
        tool_results=[tr],
        started_at=100.0,
        ended_at=101.0,
        model="gpt-4o-mini",
        provider="openai",
    )
    result = AgentResult(
        messages=[
            Message(role=Role.USER, content="echo hi"),
            Message(role=Role.ASSISTANT, content="I'll echo that.", tool_calls=[tc]),
            Message(role=Role.TOOL, tool_result=tr),
            Message(role=Role.ASSISTANT, content="Done!"),
        ],
        turns=[turn],
        finish_reason=finish,
        total_tokens=100,
        total_cost_usd=0.001,
        total_duration_s=1.0,
    )
    return store.save(result, tag=finish)


def test_replay_player_loads_run(tmp_path: Path):
    store = SessionStore(tmp_path)
    path = _save_run(store)
    player = ReplayPlayer(path)
    assert player.finish_reason == "complete"
    assert player.turn_count == 1
    assert player.total_tokens == 100


def test_replay_player_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        ReplayPlayer(tmp_path / "nonexistent.json")


def test_replay_dry_run_yields_steps(tmp_path: Path):
    store = SessionStore(tmp_path)
    path = _save_run(store)
    player = ReplayPlayer(path)
    steps = list(player.play(mode=ReplayMode.DRY_RUN))
    # Should have: provider_call + tool_call + turn_end = 3 steps.
    assert len(steps) == 3
    actions = [s.action for s in steps]
    assert actions == ["provider_call", "tool_call", "turn_end"]
    # The provider_call step should have model info.
    assert steps[0].saved_data.get("model") == "gpt-4o-mini"
    # The tool_call step should have the tool name.
    assert steps[1].saved_data.get("name") == "echo"


def test_replay_summary(tmp_path: Path):
    store = SessionStore(tmp_path)
    path = _save_run(store)
    player = ReplayPlayer(path)
    s = player.summary()
    assert "complete" in s
    assert "Turn 0" in s
    assert "echo" in s
    assert "gpt-4o-mini" in s


def test_replay_live_replay_compares_results(tmp_path: Path):
    """In live-replay mode, the tool call is re-executed and compared."""
    store = SessionStore(tmp_path)
    path = _save_run(store)
    # Build a registry with the echo tool.
    reg = ToolRegistry()

    @tool(name="echo")
    def echo(text: str) -> str:
        """Echo back."""
        return text

    register_all(reg, echo)
    player = ReplayPlayer(path, registry=reg, workspace=tmp_path)
    steps = list(player.play(mode=ReplayMode.LIVE_REPLAY))
    # The tool_call step should have live_data populated.
    tool_step = next(s for s in steps if s.action == "tool_call")
    assert tool_step.live_data is not None
    assert tool_step.live_data["ok"] is True
    # Since the saved result was "hi" and the live result is "hi", no diff.
    assert tool_step.diff is None


def test_replay_live_replay_detects_diff(tmp_path: Path):
    """When the live result differs from saved, diff should be set."""
    store = SessionStore(tmp_path)
    path = _save_run(store)
    # Build a registry with an echo tool that returns something different.
    reg = ToolRegistry()

    @tool(name="echo")
    def echo(text: str) -> str:
        """Echo back (but differently)."""
        return "DIFFERENT_OUTPUT"

    register_all(reg, echo)
    player = ReplayPlayer(path, registry=reg, workspace=tmp_path)
    steps = list(player.play(mode=ReplayMode.LIVE_REPLAY))
    tool_step = next(s for s in steps if s.action == "tool_call")
    assert tool_step.live_data is not None
    # Saved was "hi", live is "DIFFERENT_OUTPUT" → diff.
    assert tool_step.diff is not None
    assert "DIFFERENT_OUTPUT" in tool_step.diff


def test_replay_live_replay_missing_tool(tmp_path: Path):
    """When the tool isn't in the registry, replay should record an error."""
    store = SessionStore(tmp_path)
    path = _save_run(store)
    reg = ToolRegistry()  # empty — no echo tool
    player = ReplayPlayer(path, registry=reg, workspace=tmp_path)
    steps = list(player.play(mode=ReplayMode.LIVE_REPLAY))
    tool_step = next(s for s in steps if s.action == "tool_call")
    assert tool_step.error is not None
    assert "not in registry" in tool_step.error


def test_replay_multiple_turns(tmp_path: Path):
    """Replay should handle runs with multiple turns."""
    store = SessionStore(tmp_path)
    tc1 = ToolCall(name="echo", arguments={"text": "a"}, id="c1")
    tc2 = ToolCall(name="echo", arguments={"text": "b"}, id="c2")
    tr1 = ToolResult(call_id="c1", name="echo", ok=True, content="a")
    tr2 = ToolResult(call_id="c2", name="echo", ok=True, content="b")
    turn1 = AgentTurn(
        index=0, request_messages=[],
        response=ProviderResponse(content="first", tool_calls=[tc1]),
        tool_results=[tr1], model="m", provider="p",
    )
    turn2 = AgentTurn(
        index=1, request_messages=[],
        response=ProviderResponse(content="done", tool_calls=[]),
        tool_results=[], model="m", provider="p",
    )
    result = AgentResult(
        messages=[
            Message(role=Role.USER, content="x"),
            Message(role=Role.ASSISTANT, content="first", tool_calls=[tc1]),
            Message(role=Role.TOOL, tool_result=tr1),
            Message(role=Role.ASSISTANT, content="done"),
        ],
        turns=[turn1, turn2],
        finish_reason="complete",
    )
    path = store.save(result, tag="complete")
    player = ReplayPlayer(path)
    steps = list(player.play())
    # 2 turns × (provider_call + tool_call + turn_end) — but turn 2 has no
    # tool calls, so it's just provider_call + turn_end.
    # Turn 1: provider_call + tool_call + turn_end = 3
    # Turn 2: provider_call + turn_end = 2
    # Total = 5
    assert len(steps) == 5
    # Turn indices should be 0, 0, 0, 1, 1.
    turn_indices = [s.turn_idx for s in steps]
    assert turn_indices == [0, 0, 0, 1, 1]
