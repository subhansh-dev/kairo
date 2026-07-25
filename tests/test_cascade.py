"""Tests for kairo.agent.cascade — confidence-based cascade routing."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kairo.agent.cascade import (
    CascadeConfig,
    CascadeRouter,
    default_confidence_scorer,
)
from kairo.config import DEFAULT_CONFIG
from kairo.errors import ProviderError, ProviderUnavailable, RateLimitError
from kairo.routing.catalog import default_catalog
from kairo.types import Message, ProviderResponse, Role


class _MockProvider:
    def __init__(self, name, *, response=None, fail_with=None):
        self.name = name
        self._response = response or ProviderResponse(content="ok", finish_reason="stop")
        self._fail_with = fail_with
        self.calls = 0

    def complete(self, *, messages, tools=None, model=None, **kwargs):
        self.calls += 1
        if self._fail_with is not None:
            raise self._fail_with
        return self._response


def _msgs():
    return [Message(role=Role.USER, content="hi")]


def test_default_confidence_scorer_high_for_stop():
    resp = ProviderResponse(content="here is a long answer that is helpful",
                            finish_reason="stop",
                            usage={"completion_tokens": 100})
    score = default_confidence_scorer(_msgs(), resp)
    assert 0.5 < score <= 1.0


def test_default_confidence_scorer_low_for_length():
    resp = ProviderResponse(content="x", finish_reason="length")
    score = default_confidence_scorer(_msgs(), resp)
    assert score < 0.5


def test_cascade_first_success_in_error_mode():
    primary = _MockProvider("p1", response=ProviderResponse(content="ok", finish_reason="stop"))
    secondary = _MockProvider("p2")
    # Build a CascadeRouter with a mocked _providers map.
    router = CascadeRouter(
        DEFAULT_CONFIG, default_catalog(),
        chain=[("p1", "m1"), ("p2", "m2")],
        cfg=CascadeConfig(strategy="error", backoff_s=0),
    )
    router._providers = {"p1": primary, "p2": secondary}
    result = router.complete(_msgs())
    assert result.winner == ("p1", "m1")
    assert primary.calls == 1
    assert secondary.calls == 0


def test_cascade_escalates_on_low_confidence():
    primary = _MockProvider("p1", response=ProviderResponse(
        content="x", finish_reason="length"  # low confidence
    ))
    secondary = _MockProvider("p2", response=ProviderResponse(
        content="here is a longer answer that should score higher",
        finish_reason="stop",
    ))
    router = CascadeRouter(
        DEFAULT_CONFIG, default_catalog(),
        chain=[("p1", "m1"), ("p2", "m2")],
        cfg=CascadeConfig(strategy="confidence", confidence_threshold=0.5, backoff_s=0),
    )
    router._providers = {"p1": primary, "p2": secondary}
    result = router.complete(_msgs())
    # Primary was tried first, secondary escalated because primary was below threshold.
    assert primary.calls == 1
    assert secondary.calls == 1
    # The winner should be whichever scored higher.
    assert result.winner in [("p1", "m1"), ("p2", "m2")]


def test_cascade_escalates_on_rate_limit_error():
    primary = _MockProvider("p1", fail_with=RateLimitError("p1", "limited", status=429))
    secondary = _MockProvider("p2", response=ProviderResponse(
        content="ok", finish_reason="stop"
    ))
    router = CascadeRouter(
        DEFAULT_CONFIG, default_catalog(),
        chain=[("p1", "m1"), ("p2", "m2")],
        cfg=CascadeConfig(strategy="error", backoff_s=0),
    )
    router._providers = {"p1": primary, "p2": secondary}
    result = router.complete(_msgs())
    assert result.winner == ("p2", "m2")


def test_cascade_all_providers_fail_raises():
    err = RateLimitError("p", "limited", status=429)
    primary = _MockProvider("p1", fail_with=err)
    secondary = _MockProvider("p2", fail_with=err)
    router = CascadeRouter(
        DEFAULT_CONFIG, default_catalog(),
        chain=[("p1", "m1"), ("p2", "m2")],
        cfg=CascadeConfig(strategy="error", backoff_s=0),
    )
    router._providers = {"p1": primary, "p2": secondary}
    from kairo.errors import KairoError
    with pytest.raises(KairoError):
        router.complete(_msgs())


def test_cascade_max_attempts_respected():
    # 3 providers in chain, max_attempts=1 means only primary + 1 fallback.
    primary = _MockProvider("p1", fail_with=RateLimitError("p1", "x", status=429))
    secondary1 = _MockProvider("p2", fail_with=RateLimitError("p2", "x", status=429))
    secondary2 = _MockProvider("p3", response=ProviderResponse(content="ok", finish_reason="stop"))
    router = CascadeRouter(
        DEFAULT_CONFIG, default_catalog(),
        chain=[("p1", "m1"), ("p2", "m2"), ("p3", "m3")],
        cfg=CascadeConfig(strategy="error", max_attempts=1, backoff_s=0),
    )
    router._providers = {"p1": primary, "p2": secondary1, "p3": secondary2}
    from kairo.errors import KairoError
    with pytest.raises(KairoError):
        router.complete(_msgs())
    assert primary.calls == 1
    assert secondary1.calls == 1
    assert secondary2.calls == 0


def test_build_cascade_from_catalog_returns_chain():
    from kairo.agent.cascade import build_cascade_from_catalog
    cfg = DEFAULT_CONFIG
    # Enable ollama (local, free) for the test.
    cfg.providers["ollama"].enabled = True
    cfg.providers["glm"].enabled = True
    chain = build_cascade_from_catalog(
        cfg, default_catalog(),
        required_caps=("code",), max_chain=3,
    )
    assert len(chain) >= 1
    assert all(isinstance(t, tuple) and len(t) == 2 for t in chain)
