"""Tests for kairo.agent.tot — Tree of Thoughts + Self-Refine."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from kairo.agent.tot import (
    SelfRefineResult,
    Thought,
    ToTResult,
    _default_evaluator,
    self_refine,
    tree_of_thoughts,
)
from kairo.config import DEFAULT_CONFIG
from kairo.types import ProviderResponse


class _MockProvider:
    def __init__(self, responses: list[str]):
        self._responses = list(responses)
        self.calls = 0

    def complete(self, *, messages, tools=None, model=None, **kwargs):
        self.calls += 1
        if not self._responses:
            return ProviderResponse(content="(no more)", finish_reason="stop")
        text = self._responses.pop(0)
        return ProviderResponse(content=text, finish_reason="stop")


def test_default_evaluator_returns_zero_for_empty():
    assert _default_evaluator("problem", "") == 0.0


def test_default_evaluator_increases_with_length():
    short = _default_evaluator("python", "x")
    long = _default_evaluator("python", "x" * 500)
    assert long > short


def test_default_evaluator_overlap_with_problem():
    no_overlap = _default_evaluator("python programming", "rust code")
    overlap = _default_evaluator("python programming", "python code")
    assert overlap > no_overlap


def test_thought_dataclass_defaults():
    t = Thought(text="hello")
    assert t.score == 0.0
    assert t.children == []
    assert t.parent is None
    assert t.depth == 0


def test_tot_returns_result_with_mocked_provider():
    # Mock provider returns JSON arrays of thoughts.
    mock = _MockProvider([
        '["thought 1", "thought 2", "thought 3"]',  # root
        '["deeper 1", "deeper 2"]',  # expansion
        '["deeper 3", "deeper 4"]',  # expansion
        '["deeper 5", "deeper 6"]',  # expansion
    ])
    with patch("kairo.providers.build_all_enabled", return_value={"test": mock}):
        cfg = DEFAULT_CONFIG
        result = tree_of_thoughts(
            "solve this problem", cfg,
            breadth=2, depth=2,
        )
    assert isinstance(result, ToTResult)
    assert result.best_score >= 0
    assert isinstance(result.best_path, list)
    assert result.duration_s >= 0


def test_tot_handles_provider_error():
    mock = MagicMock()
    mock.complete.side_effect = RuntimeError("boom")
    with patch("kairo.providers.build_all_enabled", return_value={"test": mock}):
        result = tree_of_thoughts("problem", DEFAULT_CONFIG, breadth=2, depth=1)
    # Should not raise; best_path may be empty or have a stub.
    assert isinstance(result, ToTResult)


def test_self_refine_returns_result():
    # Initial output, then NO_FEEDBACK (which stops the loop).
    mock = _MockProvider([
        "initial output",
        "NO_FEEDBACK",
    ])
    with patch("kairo.providers.build_all_enabled", return_value={"test": mock}):
        result = self_refine("write a poem", DEFAULT_CONFIG, max_iterations=3)
    assert isinstance(result, SelfRefineResult)
    assert result.final_output == "initial output"
    assert result.iterations_used == 0  # NO_FEEDBACK stopped before any iteration


def test_self_refine_iterates_when_feedback_present():
    mock = _MockProvider([
        "initial",
        "needs more detail",  # critique 1
        "improved v1",  # refine 1
        "NO_FEEDBACK",  # critique 2 — stops
    ])
    with patch("kairo.providers.build_all_enabled", return_value={"test": mock}):
        result = self_refine("write a poem", DEFAULT_CONFIG, max_iterations=3)
    assert result.final_output == "improved v1"
    assert result.iterations_used == 1
    assert result.iterations[0][0] == "needs more detail"
    assert result.iterations[0][1] == "improved v1"


def test_self_refine_hits_max_iterations():
    mock = _MockProvider([
        "v0",
        "needs work", "v1",
        "still needs work", "v2",
        "more work needed", "v3",
    ])
    with patch("kairo.providers.build_all_enabled", return_value={"test": mock}):
        result = self_refine("x", DEFAULT_CONFIG, max_iterations=3)
    assert result.iterations_used == 3
    assert result.final_output == "v3"
