"""Tests for kairo.agent.swarm — fan-out, pipeline, tree-search."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from kairo.agent.swarm import (
    FanOutResult,
    SubTask,
    SubTaskResult,
    fan_out,
    pipeline,
    subtasks_from_text,
    summarize_fan_out,
)
from kairo.agent.swarm.tree_search import (
    TreeSearchResult,
    default_critic_factory,
    tree_search,
)
from kairo.types import AgentResult, Message, Role


# ---------------------------------------------------------------------------
# Subtask parsing
# ---------------------------------------------------------------------------

def test_subtasks_from_text_markdown_checklist():
    text = """Here's the plan:
- [ ] First thing
- [ ] Second thing
- [ ] Third thing
"""
    sts = subtasks_from_text(text)
    assert len(sts) == 3
    assert sts[0].id == "subtask_1"
    assert sts[0].prompt == "First thing"
    assert sts[2].prompt == "Third thing"


def test_subtasks_from_text_numbered_list():
    text = """1. First
2. Second
3. Third
"""
    sts = subtasks_from_text(text)
    assert len(sts) == 3


def test_subtasks_from_text_ignores_non_list_lines():
    text = """Some intro text.

- [ ] Real item
Another paragraph.
"""
    sts = subtasks_from_text(text)
    assert len(sts) == 1
    assert sts[0].prompt == "Real item"


# ---------------------------------------------------------------------------
# Fan-out — uses a mocked _run_subtask
# ---------------------------------------------------------------------------

def _fake_subtask_result(st: SubTask, ok: bool = True, text: str = "done") -> SubTaskResult:
    return SubTaskResult(
        subtask=st,
        agent_result=AgentResult(
            messages=[Message(role=Role.ASSISTANT, content=text)],
            turns=[],
            finish_reason="complete" if ok else "error",
        ),
        final_text=text if ok else "",
    )


def test_fan_out_runs_all_subtasks(tmp_workspace):
    sts = [SubTask(id=f"s{i}", prompt=f"task {i}") for i in range(3)]
    # Patch _run_subtask in the swarm module to avoid real agent runs.
    with patch("kairo.agent.swarm._run_subtask") as mock_run:
        # Each call returns a different fake result.
        mock_run.side_effect = [_fake_subtask_result(s) for s in sts]
        from kairo.config import DEFAULT_CONFIG
        result = fan_out(sts, DEFAULT_CONFIG, workspace=tmp_workspace)
    assert isinstance(result, FanOutResult)
    assert len(result.results) == 3
    assert result.success_count == 3
    assert mock_run.call_count == 3


def test_fan_out_handles_child_failure(tmp_workspace):
    sts = [SubTask(id="ok", prompt="good"), SubTask(id="bad", prompt="bad")]
    with patch("kairo.agent.swarm._run_subtask") as mock_run:
        mock_run.side_effect = [
            _fake_subtask_result(sts[0], ok=True),
            _fake_subtask_result(sts[1], ok=False, text=""),
        ]
        from kairo.config import DEFAULT_CONFIG
        result = fan_out(sts, DEFAULT_CONFIG, workspace=tmp_workspace)
    assert result.success_count == 1
    assert len(result.results) == 2


def test_fan_out_empty_returns_empty():
    from kairo.config import DEFAULT_CONFIG
    result = fan_out([], DEFAULT_CONFIG, workspace=Path("/tmp"))
    assert result.results == []
    assert result.success_count == 0


def test_summarize_fan_out_formats():
    sts = [SubTask(id="s1", prompt="do thing")]
    result = FanOutResult(
        results=[_fake_subtask_result(sts[0])],
        duration_s=1.5,
        success_count=1,
    )
    s = summarize_fan_out(result)
    assert "1/1 succeeded" in s
    assert "s1" in s
    assert "do thing" in s


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def test_pipeline_chains_outputs(tmp_workspace):
    sts = [SubTask(id="a", prompt="step 1"),
           SubTask(id="b", prompt="step 2")]
    # Mock: first call returns "intermediate", second returns "final".
    with patch("kairo.agent.swarm._run_subtask") as mock_run:
        mock_run.side_effect = [
            _fake_subtask_result(sts[0], text="intermediate"),
            _fake_subtask_result(sts[1], text="final"),
        ]
        from kairo.config import DEFAULT_CONFIG
        result = pipeline(sts, DEFAULT_CONFIG, workspace=tmp_workspace)
    assert result.success is True
    assert result.final_text == "final"
    # The second subtask's prompt should have included the first output.
    second_call_args = mock_run.call_args_list[1]
    second_prompt = second_call_args[0][0].prompt  # first positional arg is SubTask
    assert "intermediate" in second_prompt


def test_pipeline_stops_on_failure(tmp_workspace):
    sts = [SubTask(id="a", prompt="step 1"),
           SubTask(id="b", prompt="step 2")]
    with patch("kairo.agent.swarm._run_subtask") as mock_run:
        mock_run.side_effect = [
            _fake_subtask_result(sts[0], ok=False, text=""),
        ]
        from kairo.config import DEFAULT_CONFIG
        result = pipeline(sts, DEFAULT_CONFIG, workspace=tmp_workspace)
    assert result.success is False
    assert mock_run.call_count == 1  # didn't run second step


# ---------------------------------------------------------------------------
# Tree search
# ---------------------------------------------------------------------------

def test_tree_search_first_success_strategy(tmp_workspace):
    sts = [SubTask(id=f"s{i}", prompt=f"approach {i}") for i in range(3)]
    with patch("kairo.agent.swarm._run_subtask") as mock_run:
        mock_run.side_effect = [
            _fake_subtask_result(sts[0], ok=False, text=""),
            _fake_subtask_result(sts[1], ok=True, text="answer 1"),
            _fake_subtask_result(sts[2], ok=True, text="answer 2"),
        ]
        from kairo.config import DEFAULT_CONFIG
        result = tree_search(
            sts, DEFAULT_CONFIG, workspace=tmp_workspace,
            strategy="first_success",
        )
    assert isinstance(result, TreeSearchResult)
    assert result.chosen.subtask.id == "s1"
    assert "first child to complete" in result.reason


def test_tree_search_self_consistency_picks_majority(tmp_workspace):
    sts = [SubTask(id=f"s{i}", prompt="x") for i in range(5)]
    with patch("kairo.agent.swarm._run_subtask") as mock_run:
        # 3 children produce "majority answer", 2 produce different.
        mock_run.side_effect = [
            _fake_subtask_result(sts[0], text="majority answer"),
            _fake_subtask_result(sts[1], text="majority answer"),
            _fake_subtask_result(sts[2], text="majority answer"),
            _fake_subtask_result(sts[3], text="different"),
            _fake_subtask_result(sts[4], text="another different"),
        ]
        from kairo.config import DEFAULT_CONFIG
        result = tree_search(
            sts, DEFAULT_CONFIG, workspace=tmp_workspace,
            strategy="self_consistency",
        )
    assert result.chosen.final_text == "majority answer"
    assert "3 of 5" in result.reason


def test_tree_search_critic_strategy(tmp_workspace):
    sts = [SubTask(id=f"s{i}", prompt="x") for i in range(3)]
    # Critic scores: s0=0.3, s1=0.9, s2=0.5
    scores = {"s0": 0.3, "s1": 0.9, "s2": 0.5}

    def critic(subtask, output):
        return scores[subtask.id]

    with patch("kairo.agent.swarm._run_subtask") as mock_run:
        mock_run.side_effect = [_fake_subtask_result(s) for s in sts]
        from kairo.config import DEFAULT_CONFIG
        result = tree_search(
            sts, DEFAULT_CONFIG, workspace=tmp_workspace,
            strategy="critic", critic=critic,
        )
    assert result.chosen.subtask.id == "s1"
    assert "0.90" in result.reason


def test_tree_search_critic_without_critic_raises(tmp_workspace):
    sts = [SubTask(id="s0", prompt="x")]
    with pytest.raises(ValueError):
        tree_search(
            sts, None,  # type: ignore[arg-type]
            workspace=tmp_workspace, strategy="critic",
        )
