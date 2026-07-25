"""Tests for kairo.agent.budget_enforcer — hard budget limits."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.agent.budget_enforcer import (
    BudgetEnforcer,
    BudgetLimit,
    BudgetUsage,
)
from kairo.errors import BudgetExceeded


def test_set_and_get_limit(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.set_limit("user:alice", BudgetLimit(max_cost_usd=5.0, max_tokens=10000))
    limit = enforcer.get_limit("user:alice")
    assert limit is not None
    assert limit.max_cost_usd == 5.0
    assert limit.max_tokens == 10000


def test_get_limit_missing_returns_none(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    assert enforcer.get_limit("nobody") is None


def test_remove_limit(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.set_limit("x", BudgetLimit(max_cost_usd=1.0))
    assert enforcer.remove_limit("x") is True
    assert enforcer.remove_limit("x") is False


def test_check_and_reserve_no_limit_always_passes(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    # No limit set — should always pass.
    enforcer.check_and_reserve("nobody", est_cost_usd=999999)


def test_check_and_reserve_within_limit(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.set_limit("alice", BudgetLimit(max_cost_usd=1.0))
    # Reserve 50 cents — should pass.
    enforcer.check_and_reserve("alice", est_cost_usd=0.50)


def test_check_and_reserve_exceeds_cost(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.set_limit("alice", BudgetLimit(max_cost_usd=1.0))
    enforcer.record_usage("alice", cost_usd=0.80)
    # Now try to reserve 30 more cents — total would be 1.10 > 1.0.
    with pytest.raises(BudgetExceeded, match="cost"):
        enforcer.check_and_reserve("alice", est_cost_usd=0.30)


def test_check_and_reserve_exceeds_tokens(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.set_limit("alice", BudgetLimit(max_tokens=1000))
    enforcer.record_usage("alice", tokens=800)
    with pytest.raises(BudgetExceeded, match="tokens"):
        enforcer.check_and_reserve("alice", est_tokens=300)


def test_check_and_reserve_exceeds_turns(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.set_limit("alice", BudgetLimit(max_turns=5))
    enforcer.record_usage("alice", turns=4)
    with pytest.raises(BudgetExceeded, match="turns"):
        enforcer.check_and_reserve("alice", est_turns=2)


def test_record_usage_accumulates(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.record_usage("alice", cost_usd=0.1, tokens=100, turns=1, wall_s=0.5)
    enforcer.record_usage("alice", cost_usd=0.2, tokens=200, turns=1, wall_s=0.5)
    usage = enforcer.get_usage("alice")
    assert usage.cost_usd == pytest.approx(0.3)
    assert usage.tokens == 300
    assert usage.turns == 2
    assert usage.wall_s == 1.0


def test_reset_usage(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.record_usage("alice", cost_usd=1.0)
    enforcer.reset_usage("alice")
    assert enforcer.get_usage("alice").cost_usd == 0.0


def test_list_scopes(tmp_path: Path):
    enforcer = BudgetEnforcer(tmp_path / "b.json")
    enforcer.set_limit("a", BudgetLimit(max_cost_usd=1.0))
    enforcer.set_limit("b", BudgetLimit(max_cost_usd=2.0))
    enforcer.record_usage("c", cost_usd=0.1)
    scopes = enforcer.list_scopes()
    assert "a" in scopes
    assert "b" in scopes
    assert "c" in scopes


def test_persists_across_instances(tmp_path: Path):
    p = tmp_path / "b.json"
    e1 = BudgetEnforcer(p)
    e1.set_limit("alice", BudgetLimit(max_cost_usd=5.0))
    e1.record_usage("alice", cost_usd=1.5)
    e2 = BudgetEnforcer(p)
    limit = e2.get_limit("alice")
    assert limit is not None
    assert limit.max_cost_usd == 5.0
    assert e2.get_usage("alice").cost_usd == 1.5


def test_budget_usage_to_from_dict():
    u = BudgetUsage(cost_usd=1.5, tokens=1000, turns=5, wall_s=10.0)
    d = u.to_dict()
    u2 = BudgetUsage.from_dict(d)
    assert u2.cost_usd == 1.5
    assert u2.tokens == 1000
    assert u2.turns == 5
    assert u2.wall_s == 10.0


def test_global_enforcer_singleton():
    from kairo.agent.budget_enforcer import get_global_enforcer
    e1 = get_global_enforcer()
    e2 = get_global_enforcer()
    assert e1 is e2
