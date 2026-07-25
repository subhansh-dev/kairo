"""Tests for kairo.agent.streaming — live token streaming agent."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from kairo.agent.streaming import StreamingAgent
from kairo.config import DEFAULT_CONFIG
from kairo.providers.streaming import StreamEvent
from kairo.types import AgentResult, Message, ProviderResponse, Role


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
    cfg.safety.max_turns = 3
    cfg.orchestrator.enabled = False
    return cfg


def test_streaming_agent_yields_text_deltas(tmp_workspace, monkeypatch):
    """End-to-end: stream text events from a fake streaming function."""
    monkeypatch.setenv("KAIRO_TEST_KEY", "fake")
    cfg = _make_cfg(tmp_workspace)
    # Fake stream: 3 text deltas + done.
    fake_events = [
        StreamEvent(kind="text_delta", data="Hel"),
        StreamEvent(kind="text_delta", data="lo"),
        StreamEvent(kind="text_delta", data="!"),
        StreamEvent(kind="done", data="stop"),
    ]
    with patch("kairo.providers.streaming.stream_openai_compat") as mock_stream:
        mock_stream.return_value = iter(fake_events)
        agent = StreamingAgent(cfg, __import__("kairo").agent.AgentConfig(
            workspace=tmp_workspace, max_turns=2,
        ))
        # Set up fake provider pool.
        mock_provider = MagicMock()
        mock_provider.cfg.base_url = "http://localhost"
        mock_provider.cfg.api_key.return_value = "fake"
        mock_provider._default_headers.return_value = {}
        mock_provider._base_url.return_value = "http://localhost"
        agent._providers = {"openai": mock_provider}
        events = list(agent.run_stream("hi"))
    # We should have collected the text deltas + a final done event.
    text_deltas = [e for e in events if e.kind == "text_delta"]
    assert len(text_deltas) >= 3
    assert "".join(e.data for e in text_deltas) == "Hello!"
    # Final done event should have usage info.
    done_events = [e for e in events if e.kind == "done"]
    assert len(done_events) >= 1


def test_streaming_agent_handles_error_event(tmp_workspace, monkeypatch):
    monkeypatch.setenv("KAIRO_TEST_KEY", "fake")
    cfg = _make_cfg(tmp_workspace)
    fake_events = [
        StreamEvent(kind="error", data="boom"),
    ]
    with patch("kairo.providers.streaming.stream_openai_compat") as mock_stream:
        mock_stream.return_value = iter(fake_events)
        agent = StreamingAgent(cfg, __import__("kairo").agent.AgentConfig(
            workspace=tmp_workspace, max_turns=2,
        ))
        mock_provider = MagicMock()
        mock_provider.cfg.base_url = "http://localhost"
        mock_provider.cfg.api_key.return_value = "fake"
        mock_provider._default_headers.return_value = {}
        mock_provider._base_url.return_value = "http://localhost"
        agent._providers = {"openai": mock_provider}
        events = list(agent.run_stream("hi"))
    # Should have an error event.
    err_events = [e for e in events if e.kind == "error"]
    assert len(err_events) >= 1
    assert "boom" in err_events[0].data


def test_streaming_agent_handles_empty_stream(tmp_workspace, monkeypatch):
    monkeypatch.setenv("KAIRO_TEST_KEY", "fake")
    cfg = _make_cfg(tmp_workspace)
    # Empty stream — just a done event with no text.
    fake_events = [StreamEvent(kind="done", data="stop")]
    with patch("kairo.providers.streaming.stream_openai_compat") as mock_stream:
        mock_stream.return_value = iter(fake_events)
        agent = StreamingAgent(cfg, __import__("kairo").agent.AgentConfig(
            workspace=tmp_workspace, max_turns=2,
        ))
        mock_provider = MagicMock()
        mock_provider.cfg.base_url = "http://localhost"
        mock_provider.cfg.api_key.return_value = "fake"
        mock_provider._default_headers.return_value = {}
        mock_provider._base_url.return_value = "http://localhost"
        agent._providers = {"openai": mock_provider}
        events = list(agent.run_stream("hi"))
    # Should complete without errors.
    done_events = [e for e in events if e.kind == "done"]
    assert len(done_events) >= 1
