"""Tests for kairo.agent.reflexion."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from kairo.agent.reflexion import (
    ReflexionResult,
    default_critic,
    llm_critic_factory,
    reflexion_run,
)
from kairo.config import DEFAULT_CONFIG
from kairo.types import AgentResult, Message, Role


def _make_result(finish="complete", error=None) -> AgentResult:
    return AgentResult(
        messages=[Message(role=Role.USER, content="q"),
                  Message(role=Role.ASSISTANT, content="done")],
        turns=[],
        finish_reason=finish,
        error=error,
    )


def test_default_critic_success():
    r = _make_result(finish="complete")
    assert default_critic("do x", r) is None


def test_default_critic_failure_finish_reason():
    r = _make_result(finish="loop_limit", error="hit max")
    out = default_critic("do x", r)
    assert out is not None
    assert "loop_limit" in out


def test_default_critic_tool_error():
    from kairo.types import AgentTurn, ToolResult, ProviderResponse
    tr = ToolResult(call_id="c1", name="read_file", ok=False, content=None,
                    error="FileNotFoundError: /nope")
    turn = AgentTurn(
        index=0, request_messages=[], tool_results=[tr],
        response=ProviderResponse(content="x", tool_calls=[]),
    )
    r = AgentResult(
        messages=[Message(role=Role.ASSISTANT, content="done")],
        turns=[turn],
        finish_reason="complete",
    )
    out = default_critic("do x", r)
    assert out is not None
    assert "read_file" in out


def test_default_critic_guardrail_not_counted():
    from kairo.types import AgentTurn, ToolResult, ProviderResponse
    tr = ToolResult(call_id="c1", name="read_file", ok=False, content=None,
                    error="GUARDRAIL [repeat_in_turn]: ...")
    turn = AgentTurn(
        index=0, request_messages=[], tool_results=[tr],
        response=ProviderResponse(content="x", tool_calls=[]),
    )
    r = AgentResult(
        messages=[Message(role=Role.ASSISTANT, content="done")],
        turns=[turn],
        finish_reason="complete",
    )
    # Guardrail errors don't trigger reflection — attempt counts as success.
    assert default_critic("do x", r) is None


def test_reflexion_run_succeeds_first_attempt(tmp_workspace):
    """Mock the Agent.run to succeed immediately."""
    with patch("kairo.agent.reflexion.Agent") as MockAgent:
        mock_instance = MockAgent.return_value
        mock_instance.run.return_value = _make_result(finish="complete")
        from kairo.config import KairoConfig
        from kairo.agent import AgentConfig
        result = reflexion_run(
            AgentConfig(workspace=tmp_workspace),
            KairoConfig(),
            "do thing",
            max_attempts=3,
        )
    assert result.succeeded is True
    assert result.attempts_used == 1
    assert len(result.attempts) == 1
    assert result.reflections == []


def test_reflexion_run_retries_on_failure(tmp_workspace):
    """First attempt fails, second succeeds."""
    with patch("kairo.agent.reflexion.Agent") as MockAgent:
        mock_instance = MockAgent.return_value
        mock_instance.run.side_effect = [
            _make_result(finish="loop_limit", error="too many turns"),
            _make_result(finish="complete"),
        ]
        from kairo.config import KairoConfig
        from kairo.agent import AgentConfig
        result = reflexion_run(
            AgentConfig(workspace=tmp_workspace),
            KairoConfig(),
            "do thing",
            max_attempts=3,
        )
    assert result.succeeded is True
    assert result.attempts_used == 2
    assert len(result.reflections) == 1


def test_reflexion_run_exhausts_attempts(tmp_workspace):
    """All attempts fail."""
    with patch("kairo.agent.reflexion.Agent") as MockAgent:
        mock_instance = MockAgent.return_value
        mock_instance.run.return_value = _make_result(finish="error", error="boom")
        from kairo.config import KairoConfig
        from kairo.agent import AgentConfig
        result = reflexion_run(
            AgentConfig(workspace=tmp_workspace),
            KairoConfig(),
            "do thing",
            max_attempts=3,
        )
    assert result.succeeded is False
    assert result.attempts_used == 3
    assert len(result.reflections) == 3


def test_reflexion_invalid_max_attempts(tmp_workspace):
    from kairo.config import KairoConfig
    from kairo.agent import AgentConfig
    with pytest.raises(ValueError):
        reflexion_run(
            AgentConfig(workspace=tmp_workspace),
            KairoConfig(),
            "x",
            max_attempts=0,
        )


def test_llm_critic_success(tmp_workspace):
    """LLM critic returns SUCCESS -> no reflection."""
    mock_agent = MagicMock()
    mock_agent.run.return_value = AgentResult(
        messages=[Message(role=Role.ASSISTANT, content="SUCCESS")],
        turns=[], finish_reason="complete",
    )
    critic = llm_critic_factory(lambda: mock_agent)
    out = critic("do x", _make_result())
    assert out is None


def test_llm_critic_reflection(tmp_workspace):
    """LLM critic returns a reflection string."""
    mock_agent = MagicMock()
    mock_agent.run.return_value = AgentResult(
        messages=[Message(role=Role.ASSISTANT, content="The attempt failed because X.")],
        turns=[], finish_reason="complete",
    )
    critic = llm_critic_factory(lambda: mock_agent)
    out = critic("do x", _make_result())
    assert out is not None
    assert "failed" in out.lower()
