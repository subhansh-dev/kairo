"""Tests for kairo.agent.checkpoint — pause/resume agent runs."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from kairo.agent import AgentConfig
from kairo.agent.checkpoint import Checkpoint, CheckpointedAgent
from kairo.config import DEFAULT_CONFIG
from kairo.types import (
    AgentResult,
    AgentTurn,
    Message,
    ProviderResponse,
    Role,
    ToolCall,
    ToolResult,
)


def _make_cfg(workspace: Path):
    import copy
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg.workdir = workspace / ".kairo"
    cfg.persist_turns = False
    for name in list(cfg.providers):
        cfg.providers[name].enabled = (name == "openai")
    cfg.providers["openai"].enabled = True
    cfg.providers["openai"].api_key_env = "KAIRO_TEST_KEY"
    cfg.providers["openai"].default_model = "gpt-4o-mini"
    cfg.safety.max_turns = 5
    cfg.orchestrator.enabled = False
    return cfg


def test_checkpoint_to_from_dict_round_trip():
    msg = Message(role=Role.USER, content="hi")
    ckpt = Checkpoint(
        run_id="r1", user_message="hi", messages=[msg], turns=[],
        total_tokens=10, total_cost_usd=0.001, finish_reason=None,
        saved_at=12345.0, agent_config={}, workspace="/tmp",
    )
    d = ckpt.to_dict()
    ckpt2 = Checkpoint.from_dict(d)
    assert ckpt2.run_id == "r1"
    assert ckpt2.user_message == "hi"
    assert len(ckpt2.messages) == 1
    assert ckpt2.messages[0].content == "hi"


def test_checkpoint_save_load(tmp_path: Path):
    ckpt = Checkpoint(
        run_id="r1", user_message="hi",
        messages=[Message(role=Role.USER, content="hi")],
        turns=[], total_tokens=0, total_cost_usd=0.0,
        finish_reason=None, saved_at=12345.0,
        agent_config={}, workspace="/tmp",
    )
    p = tmp_path / "ck.json"
    ckpt.save(p)
    assert p.exists()
    ckpt2 = Checkpoint.load(p)
    assert ckpt2.run_id == "r1"


def test_checkpoint_serializes_tool_calls():
    tc = ToolCall(name="read_file", arguments={"path": "x"})
    msg = Message(role=Role.ASSISTANT, content="thinking", tool_calls=[tc])
    ckpt = Checkpoint(
        run_id="r1", user_message="hi", messages=[msg], turns=[],
        total_tokens=0, total_cost_usd=0.0, finish_reason=None,
        saved_at=12345.0, agent_config={}, workspace="/tmp",
    )
    d = ckpt.to_dict()
    ckpt2 = Checkpoint.from_dict(d)
    assert len(ckpt2.messages[0].tool_calls) == 1
    assert ckpt2.messages[0].tool_calls[0].name == "read_file"


def test_checkpoint_serializes_tool_results():
    tr = ToolResult(call_id="c1", name="read_file", ok=True, content="data")
    msg = Message(role=Role.TOOL, tool_result=tr)
    ckpt = Checkpoint(
        run_id="r1", user_message="hi", messages=[msg], turns=[],
        total_tokens=0, total_cost_usd=0.0, finish_reason=None,
        saved_at=12345.0, agent_config={}, workspace="/tmp",
    )
    d = ckpt.to_dict()
    ckpt2 = Checkpoint.from_dict(d)
    assert ckpt2.messages[0].tool_result is not None
    assert ckpt2.messages[0].tool_result.content == "data"


def test_checkpointed_agent_creates_checkpoint_dir(tmp_path: Path):
    ckpt_dir = tmp_path / "ckpts"
    agent = CheckpointedAgent(
        _make_cfg(tmp_path),
        AgentConfig(workspace=tmp_path),
        checkpoint_dir=ckpt_dir,
    )
    assert ckpt_dir.exists()


def test_checkpointed_agent_run_writes_checkpoint(tmp_path: Path, monkeypatch):
    """End-to-end: run an agent with a fake provider, verify a checkpoint file is written."""
    monkeypatch.setenv("KAIRO_TEST_KEY", "fake")
    cfg = _make_cfg(tmp_path)

    # Mock the OpenAI provider to return a single "complete" response.
    fake_resp = ProviderResponse(content="hello", finish_reason="stop")

    @pytest.fixture(autouse=True)
    def _patch_provider(monkeypatch):
        from kairo.providers.base import Provider, register_provider
        from kairo.types import ProviderName, ProviderResponse as PR

        class _Fake(Provider):
            name: ProviderName = "openai"

            def __init__(self, cfg):
                super().__init__(cfg)

            def _complete(self, *, messages, tools, model, temperature, max_tokens, **kwargs):
                return PR(content="hello", finish_reason="stop")

        register_provider("openai")(_Fake)

    # Set up the fake provider.
    from kairo.providers.base import Provider, register_provider
    from kairo.types import ProviderName, ProviderResponse as PR

    class _FakeProvider(Provider):
        name: ProviderName = "openai"

        def __init__(self, cfg):
            super().__init__(cfg)

        def _complete(self, *, messages, tools, model, temperature, max_tokens, **kwargs):
            return PR(content="hello", finish_reason="stop")

    # Register it (overrides the existing openai registration).
    register_provider("openai")(_FakeProvider)

    ckpt_dir = tmp_path / "ckpts"
    ck_agent = CheckpointedAgent(
        cfg,
        AgentConfig(workspace=tmp_path, max_turns=2),
        checkpoint_dir=ckpt_dir,
    )
    result = ck_agent.run("hi")
    # Checkpoint file should exist.
    ckpt_files = list(ckpt_dir.glob("*.json"))
    assert len(ckpt_files) >= 1
    # Verify the checkpoint content.
    ckpt = Checkpoint.load(ckpt_files[0])
    assert ckpt.user_message == "hi"
    assert ckpt.finish_reason == "complete"
