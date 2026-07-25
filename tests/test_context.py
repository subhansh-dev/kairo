"""Tests for kairo.agent.context — token estimation + compaction."""

from __future__ import annotations

from kairo.agent.context import (
    ContextManager,
    estimate_conversation_tokens,
    estimate_tokens,
)
from kairo.config import ContextConfig
from kairo.types import Message, Role, ToolCall, ToolResult


def test_estimate_tokens_nonzero():
    assert estimate_tokens("hello world", ContextConfig()) > 0


def test_estimate_tokens_empty():
    assert estimate_tokens("", ContextConfig()) == 0


def test_estimate_conversation_tokens_sums_messages():
    cfg = ContextConfig()
    msgs = [
        Message(role=Role.USER, content="abc"),
        Message(role=Role.ASSISTANT, content="def"),
    ]
    total = estimate_conversation_tokens(msgs, cfg)
    assert total > 0


def test_compact_noop_below_threshold():
    cfg = ContextConfig(compact_at_fraction=0.75, keep_last_turns=2)
    cm = ContextManager(cfg)
    msgs = [
        Message(role=Role.SYSTEM, content="sys"),
        Message(role=Role.USER, content="hi"),
        Message(role=Role.ASSISTANT, content="hello"),
    ]
    res = cm.maybe_compact(msgs, model_context=100_000)
    assert res.removed_count == 0
    assert res.summary is None
    assert res.messages is msgs


def test_compact_when_over_threshold():
    cfg = ContextConfig(compact_at_fraction=0.01, keep_last_turns=2, tokens_per_char=1.0)
    cm = ContextManager(cfg)
    big = "x" * 500
    msgs = [
        Message(role=Role.SYSTEM, content="sys"),
        Message(role=Role.USER, content=big),
        Message(role=Role.ASSISTANT, content=big),
        Message(role=Role.USER, content=big),
        Message(role=Role.ASSISTANT, content=big),
        Message(role=Role.USER, content="recent 1"),
        Message(role=Role.ASSISTANT, content="recent 2"),
    ]
    res = cm.maybe_compact(msgs, model_context=10_000)
    assert res.removed_count > 0
    assert res.summary is not None
    # Anchor + summary + tail kept.
    assert len(res.messages) < len(msgs)


def test_compact_short_conversation_noop():
    cfg = ContextConfig(compact_at_fraction=0.01, keep_last_turns=2)
    cm = ContextManager(cfg)
    msgs = [Message(role=Role.USER, content="hi")]
    res = cm.compact(msgs)
    assert res.removed_count == 0
