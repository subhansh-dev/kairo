"""Integration test: full agent loop against a fake provider.

This is the most important test in the suite — it proves the wiring
end-to-end without needing real API keys or network access.

Strategy: we monkey-patch a fake Provider into the provider registry
that returns canned responses. The agent loop then drives the loop,
dispatches real tools, and we assert on the resulting state.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kairo.agent import Agent, AgentConfig
from kairo.config import DEFAULT_CONFIG, KairoConfig
from kairo.providers.base import Provider, register_provider
from kairo.types import (
    Message,
    ProviderName,
    ProviderResponse,
    Role,
    ToolCall,
)


# ---------------------------------------------------------------------------
# Fake provider with a scripted response sequence
# ---------------------------------------------------------------------------

class FakeProvider(Provider):
    """Provider that returns pre-loaded responses in order."""

    name: ProviderName = "openai"  # type: ignore[assignment]

    def __init__(self, cfg, responses):
        super().__init__(cfg)
        self._responses = list(responses)
        self.calls: list[dict] = []

    def _complete(self, *, messages, tools, model, temperature, max_tokens, **kwargs):
        self.calls.append({
            "messages": messages,
            "tools": tools,
            "model": model,
        })
        if not self._responses:
            return ProviderResponse(content="(no more scripted responses)", tool_calls=[])
        return self._responses.pop(0)


def _make_response(content="", tool_calls=None):
    return ProviderResponse(content=content, tool_calls=tool_calls or [])


def _make_cfg(workspace: Path) -> KairoConfig:
    import copy
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg.workdir = workspace / ".kairo"
    cfg.persist_turns = False
    # Disable every provider except openai (which we will override).
    for name in list(cfg.providers):
        cfg.providers[name].enabled = (name == "openai")
    cfg.providers["openai"].enabled = True
    cfg.providers["openai"].api_key_env = "KAIRO_TEST_KEY"
    cfg.providers["openai"].default_model = "gpt-4o-mini"
    # Keep the safety limits tight for fast tests.
    cfg.safety.max_turns = 10
    cfg.orchestrator.enabled = False  # single-model mode for these tests
    return cfg


@pytest.fixture
def fake_provider(monkeypatch):
    """Replace OpenAIProvider in the registry with our FakeProvider."""
    responses: list[ProviderResponse] = []
    instance: list[FakeProvider] = []

    @register_provider("openai")  # overrides the previous registration
    class _Fake(FakeProvider):
        name = "openai"

        def __init__(self, cfg):
            super().__init__(cfg, responses)
            instance.append(self)

    monkeypatch.setenv("KAIRO_TEST_KEY", "fake")

    def _set_responses(*r):
        responses.clear()
        responses.extend(r)

    def _get():
        return instance[-1] if instance else None

    return _set_responses, _get


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_agent_completes_without_tool_calls(tmp_workspace, fake_provider):
    set_r, get = fake_provider
    set_r(_make_response(content="Hello! How can I help?"))
    cfg = _make_cfg(tmp_workspace)
    agent = Agent(cfg, AgentConfig(workspace=tmp_workspace))
    result = agent.run("hi")
    assert result.finish_reason == "complete"
    assert len(result.turns) == 1
    assert "Hello" in result.messages[-1].content


def test_agent_executes_tool_call_then_finishes(tmp_workspace, fake_provider):
    set_r, get = fake_provider
    # Turn 1: model calls read_file on hello.txt
    # Turn 2: model reports the content
    set_r(
        _make_response(
            content="Let me read it.",
            tool_calls=[ToolCall(name="write_file", arguments={
                "path": "hello.txt", "content": "hi from tool"
            })],
        ),
        _make_response(content="I wrote hello.txt with the content 'hi from tool'."),
    )
    cfg = _make_cfg(tmp_workspace)
    agent = Agent(cfg, AgentConfig(workspace=tmp_workspace))
    result = agent.run("Write hello.txt with 'hi from tool'")
    assert result.finish_reason == "complete"
    assert (tmp_workspace / "hello.txt").read_text() == "hi from tool"
    assert len(result.turns) == 2


def test_agent_loops_until_max_turns(tmp_workspace, fake_provider):
    set_r, get = fake_provider
    # Always return a tool call — should hit loop limit.
    set_r(*[
        _make_response(
            content=f"thinking {i}",
            tool_calls=[ToolCall(name="list_dir", arguments={"path": "."})],
        )
        for i in range(20)
    ])
    cfg = _make_cfg(tmp_workspace)
    cfg.safety.max_turns = 3
    agent = Agent(cfg, AgentConfig(workspace=tmp_workspace))
    result = agent.run("loop forever")
    assert result.finish_reason == "loop_limit"
    assert len(result.turns) == 3


def test_agent_guardrail_blocks_repeated_call(tmp_workspace, fake_provider):
    set_r, get = fake_provider
    # Model tries to call read_file on the same path 3 times in 3 turns.
    bad_call = ToolCall(name="read_file", arguments={"path": "nonexistent.txt"})
    set_r(
        _make_response(content="try once", tool_calls=[bad_call]),
        _make_response(content="try twice", tool_calls=[bad_call]),
        _make_response(content="try thrice", tool_calls=[bad_call]),
        _make_response(content="try four", tool_calls=[bad_call]),
        _make_response(content="ok I'll stop"),
    )
    cfg = _make_cfg(tmp_workspace)
    cfg.safety.max_turns = 8
    agent = Agent(cfg, AgentConfig(workspace=tmp_workspace))
    # Tighten the spam guard for this test.
    from kairo.tools.guardrails import SpamGuardConfig
    agent.guard.cfg = SpamGuardConfig(max_repeat_across_turns=2, max_repeat_per_turn=10)
    result = agent.run("keep trying read_file")
    # The agent should have completed (model said "ok I'll stop"), and at
    # least one tool result should contain a guardrail error.
    tool_msgs = [m for m in result.messages if m.role == Role.TOOL]
    guard_errors = [
        m for m in tool_msgs
        if m.tool_result and m.tool_result.error and "repeat_across_turns" in m.tool_result.error
    ]
    assert len(guard_errors) >= 1


def test_agent_unknown_tool_returns_error_result(tmp_workspace, fake_provider):
    set_r, get = fake_provider
    set_r(
        _make_response(
            content="calling bogus tool",
            tool_calls=[ToolCall(name="bogus_tool", arguments={})],
        ),
        _make_response(content="ok I see it failed"),
    )
    cfg = _make_cfg(tmp_workspace)
    agent = Agent(cfg, AgentConfig(workspace=tmp_workspace))
    result = agent.run("call a bogus tool")
    assert result.finish_reason == "complete"
    tool_msgs = [m for m in result.messages if m.role == Role.TOOL]
    assert any(m.tool_result and not m.tool_result.ok for m in tool_msgs)
