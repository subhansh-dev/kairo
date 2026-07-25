"""Tests for kairo.agent.failover — provider retry on failure."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kairo.agent.failover import FailoverConfig, FailoverProvider
from kairo.errors import ProviderError, ProviderUnavailable, RateLimitError
from kairo.types import Message, ProviderResponse, Role


class _MockProvider:
    def __init__(self, name, *, fail_with=None, response=None):
        self.name = name
        self._fail_with = fail_with
        self._response = response or ProviderResponse(content="ok")
        self.calls = 0

    def complete(self, *, messages, tools=None, model=None, **kwargs):
        self.calls += 1
        if self._fail_with is not None:
            raise self._fail_with
        return self._response


def _msgs():
    return [Message(role=Role.USER, content="hi")]


def test_failover_succeeds_on_first_try():
    primary = _MockProvider("p1", response=ProviderResponse(content="primary ok"))
    fb = FailoverProvider(primary, "m1", [], FailoverConfig(backoff_s=0))
    resp = fb.complete(_msgs(), model="m1")
    assert resp.content == "primary ok"
    assert primary.calls == 1


def test_failover_to_secondary_on_rate_limit():
    primary = _MockProvider("p1", fail_with=RateLimitError("p1", "limited", status=429))
    secondary = _MockProvider("p2", response=ProviderResponse(content="secondary ok"))
    fb = FailoverProvider(primary, "m1", [(secondary, "m2")], FailoverConfig(backoff_s=0))
    resp = fb.complete(_msgs(), model="m1")
    assert resp.content == "secondary ok"
    assert primary.calls == 1
    assert secondary.calls == 1


def test_failover_to_secondary_on_provider_unavailable():
    primary = _MockProvider("p1", fail_with=ProviderUnavailable("p1", "down"))
    secondary = _MockProvider("p2", response=ProviderResponse(content="secondary ok"))
    fb = FailoverProvider(primary, "m1", [(secondary, "m2")], FailoverConfig(backoff_s=0))
    resp = fb.complete(_msgs(), model="m1")
    assert resp.content == "secondary ok"


def test_failover_on_5xx_provider_error():
    primary = _MockProvider("p1", fail_with=ProviderError("p1", "boom", status=503))
    secondary = _MockProvider("p2", response=ProviderResponse(content="ok"))
    fb = FailoverProvider(primary, "m1", [(secondary, "m2")], FailoverConfig(backoff_s=0))
    resp = fb.complete(_msgs(), model="m1")
    assert resp.content == "ok"


def test_failover_does_not_retry_4xx_client_error():
    primary = _MockProvider("p1", fail_with=ProviderError("p1", "bad request", status=400))
    secondary = _MockProvider("p2", response=ProviderResponse(content="ok"))
    fb = FailoverProvider(primary, "m1", [(secondary, "m2")], FailoverConfig(backoff_s=0))
    with pytest.raises(ProviderError):
        fb.complete(_msgs(), model="m1")
    # Secondary should NOT have been tried.
    assert secondary.calls == 0


def test_failover_all_providers_fail_raises_last_error():
    err1 = RateLimitError("p1", "limited", status=429)
    err2 = RateLimitError("p2", "limited", status=429)
    primary = _MockProvider("p1", fail_with=err1)
    secondary = _MockProvider("p2", fail_with=err2)
    fb = FailoverProvider(primary, "m1", [(secondary, "m2")], FailoverConfig(backoff_s=0))
    with pytest.raises(RateLimitError):
        fb.complete(_msgs(), model="m1")
    assert primary.calls == 1
    assert secondary.calls == 1


def test_failover_disabled_does_not_try_secondary():
    primary = _MockProvider("p1", fail_with=RateLimitError("p1", "limited", status=429))
    secondary = _MockProvider("p2", response=ProviderResponse(content="ok"))
    fb = FailoverProvider(primary, "m1", [(secondary, "m2")], FailoverConfig(enabled=False, backoff_s=0))
    with pytest.raises(RateLimitError):
        fb.complete(_msgs(), model="m1")
    assert secondary.calls == 0


def test_failover_max_attempts_respected():
    # Three fallbacks, but max_attempts=1 means we only try one fallback.
    err = RateLimitError("p", "limited", status=429)
    primary = _MockProvider("p1", fail_with=err)
    secondary1 = _MockProvider("p2", fail_with=err)
    secondary2 = _MockProvider("p3", fail_with=err)
    secondary3 = _MockProvider("p4", response=ProviderResponse(content="ok"))
    fb = FailoverProvider(
        primary, "m1",
        [(secondary1, "m2"), (secondary2, "m3"), (secondary3, "m4")],
        FailoverConfig(max_attempts=1, backoff_s=0),
    )
    # With max_attempts=1, we try primary + 1 fallback = 2 attempts.
    with pytest.raises(RateLimitError):
        fb.complete(_msgs(), model="m1")
    assert primary.calls == 1
    assert secondary1.calls == 1
    assert secondary2.calls == 0
    assert secondary3.calls == 0
