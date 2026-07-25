"""Tests for kairo.tenant — multi-tenant isolation."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.tenant import Tenant, TenantManager


def test_tenant_manager_creates_tenant(tmp_path: Path):
    mgr = TenantManager(tmp_path)
    t = mgr.get_or_create("alice")
    assert t.user_id == "alice"
    assert t.workspace.is_dir()
    assert t.memory_dir.is_dir()
    assert t.runs_dir.is_dir()
    assert t.budget_scope == "user:alice"


def test_tenant_manager_caches(tmp_path: Path):
    mgr = TenantManager(tmp_path)
    t1 = mgr.get_or_create("alice")
    t2 = mgr.get_or_create("alice")
    assert t1 is t2  # same object from cache


def test_tenant_manager_evict(tmp_path: Path):
    mgr = TenantManager(tmp_path)
    mgr.get_or_create("alice")
    assert mgr.evict("alice") is True
    assert mgr.evict("alice") is False  # already evicted
    # Get again — should create a new instance.
    t = mgr.get_or_create("alice")
    assert t is not None


def test_tenant_manager_delete(tmp_path: Path):
    mgr = TenantManager(tmp_path)
    t = mgr.get_or_create("alice")
    assert t.base_dir.exists()
    assert mgr.delete("alice") is True
    assert not t.base_dir.exists()
    assert mgr.delete("alice") is False  # already deleted


def test_tenant_manager_list_tenants(tmp_path: Path):
    mgr = TenantManager(tmp_path)
    mgr.get_or_create("alice")
    mgr.get_or_create("bob")
    mgr.get_or_create("carol")
    tenants = mgr.list_tenants()
    assert "alice" in tenants
    assert "bob" in tenants
    assert "carol" in tenants


def test_tenant_manager_sanitizes_user_id(tmp_path: Path):
    mgr = TenantManager(tmp_path)
    t = mgr.get_or_create("user@domain.com/../etc/passwd")
    # Special chars should be replaced with underscore.
    assert "/" not in t.user_id
    assert "@" not in t.user_id
    assert "." not in t.user_id
    assert t.user_id.startswith("user")


def test_tenant_manager_empty_user_id(tmp_path: Path):
    mgr = TenantManager(tmp_path)
    t = mgr.get_or_create("")
    assert t.user_id == "anonymous"


def test_tenant_isolation_separate_workspaces(tmp_path: Path):
    """Two tenants should have separate workspace directories."""
    mgr = TenantManager(tmp_path)
    alice = mgr.get_or_create("alice")
    bob = mgr.get_or_create("bob")
    assert alice.workspace != bob.workspace
    # Write a file in alice's workspace — bob shouldn't see it.
    (alice.workspace / "secret.txt").write_text("alice's secret")
    assert (alice.workspace / "secret.txt").exists()
    assert not (bob.workspace / "secret.txt").exists()


def test_tenant_isolation_separate_memory(tmp_path: Path):
    """Two tenants should have separate memory stores."""
    mgr = TenantManager(tmp_path)
    alice = mgr.get_or_create("alice")
    bob = mgr.get_or_create("bob")
    am = alice.get_memory()
    am.episodic.record("x", "alice's event")
    bm = bob.get_memory()
    assert len(bm.episodic.recent()) == 0
    assert len(am.episodic.recent()) == 1


def test_tenant_isolation_separate_learning(tmp_path: Path):
    """Two tenants should have separate learning graphs."""
    mgr = TenantManager(tmp_path)
    alice = mgr.get_or_create("alice")
    bob = mgr.get_or_create("bob")
    ag = alice.get_learning_graph()
    ag.record_success(
        prompt="alice's task", system_prompt="",
        model="m", provider="p", tools_used=["t"],
        tool_call_count=1, final_text="done", duration_s=1, tokens=10,
    )
    bg = bob.get_learning_graph()
    assert len(bg.entries) == 0
    assert len(ag.entries) == 1


def test_tenant_isolation_separate_budgets(tmp_path: Path):
    """Two tenants should have separate budget scopes."""
    mgr = TenantManager(tmp_path)
    alice = mgr.get_or_create("alice")
    bob = mgr.get_or_create("bob")
    from kairo.agent.budget_enforcer import BudgetLimit, get_global_enforcer
    enforcer = get_global_enforcer()
    alice.set_budget_limit(BudgetLimit(max_turns=5))
    enforcer.record_usage("user:alice", turns=3)
    # Alice should have usage; Bob should not.
    assert alice.get_usage().turns == 3
    assert bob.get_usage().turns == 0


def test_tenant_build_agent(tmp_path: Path, monkeypatch):
    """build_agent should produce a working Agent scoped to the tenant."""
    monkeypatch.setenv("KAIRO_TEST_KEY", "fake")
    from kairo.config import DEFAULT_CONFIG
    import copy
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for name in list(cfg.providers):
        cfg.providers[name].enabled = (name == "openai")
    cfg.providers["openai"].enabled = True
    cfg.providers["openai"].api_key_env = "KAIRO_TEST_KEY"
    cfg.providers["openai"].default_model = "gpt-4o-mini"
    cfg.safety.max_turns = 3

    mgr = TenantManager(tmp_path)
    alice = mgr.get_or_create("alice")
    agent = alice.build_agent(cfg, system_prompt="test", max_turns=2)
    assert agent.acfg.workspace == alice.workspace
    assert agent._budget_scope == "user:alice"


def test_tenant_get_session_store(tmp_path: Path):
    mgr = TenantManager(tmp_path)
    alice = mgr.get_or_create("alice")
    store = alice.get_session_store()
    assert store.runs_dir == alice.runs_dir
