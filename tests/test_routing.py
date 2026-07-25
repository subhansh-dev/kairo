"""Tests for kairo.routing — classifier, catalog, router."""

from __future__ import annotations

import pytest

from kairo.config import KairoConfig, RouterConfig
from kairo.errors import RouterError
from kairo.routing.catalog import ModelCatalog, default_catalog
from kairo.routing.classifier import classify_task
from kairo.routing.router import Router, RouterContext
from kairo.routing.orchestrator import Orchestrator
from kairo.types import Message, ModelInfo, Role, TaskKind


# ---------------------------------------------------------------------------
# Classifier
# ---------------------------------------------------------------------------

def test_classify_plan():
    msgs = [Message(role=Role.USER, content="Plan the next sprint for the API")]
    assert classify_task(msgs) == TaskKind.PLAN


def test_classify_tests():
    msgs = [Message(role=Role.USER, content="Write tests for the foo module")]
    assert classify_task(msgs) == TaskKind.TESTS


def test_classify_debug():
    msgs = [Message(role=Role.USER, content="Debug this traceback I'm getting")]
    assert classify_task(msgs) == TaskKind.DEBUG


def test_classify_summary():
    msgs = [Message(role=Role.USER, content="Summarize the discussion")]
    assert classify_task(msgs) == TaskKind.SUMMARY


def test_classify_general_fallback():
    msgs = [Message(role=Role.USER, content="ok")]
    assert classify_task(msgs) == TaskKind.GENERAL


def test_classify_empty_messages():
    assert classify_task([]) == TaskKind.GENERAL


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

def test_catalog_add_and_get():
    c = ModelCatalog()
    info = ModelInfo("m", "openai", context=8192, cost_in_per_m=1, cost_out_per_m=2,
                     capabilities=("code",))
    c.add(info)
    assert c.get("openai", "m") is info
    with pytest.raises(RouterError):
        c.get("openai", "nope")


def test_catalog_get_by_key():
    c = ModelCatalog()
    info = ModelInfo("m", "openai", context=8192, cost_in_per_m=1, cost_out_per_m=2)
    c.add(info)
    assert c.get_by_key("openai:m") is info
    with pytest.raises(RouterError):
        c.get_by_key("bogus")


def test_default_catalog_has_known_models():
    c = default_catalog()
    assert len(c) > 5
    assert "openai:gpt-4o-mini" in c
    assert "anthropic:claude-3-5-sonnet-20241022" in c
    assert "glm:glm-4.6" in c


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

def _kcfg() -> KairoConfig:
    from kairo.config import DEFAULT_CONFIG
    return DEFAULT_CONFIG


def test_router_picks_default_on_no_match():
    cfg = _kcfg()
    cfg.router.prefer_cheapest = True
    r = Router(default_catalog(), cfg)
    d = r.pick(RouterContext(messages=[Message(role=Role.USER, content="ok")]))
    assert d.model is not None
    assert "task=general" in d.reason or "fallback" in d.reason


def test_router_override_wins():
    cfg = _kcfg()
    cfg.router.overrides = {"code": "openai:gpt-4o-mini"}
    r = Router(default_catalog(), cfg)
    msgs = [Message(role=Role.USER, content="Write code for foo")]
    d = r.pick(RouterContext(messages=msgs))
    assert d.model.name == "gpt-4o-mini"
    assert d.model.provider == "openai"


def test_router_filters_by_context():
    cfg = _kcfg()
    r = Router(default_catalog(), cfg)
    # Force a huge context that no small model can serve.
    d = r.pick(RouterContext(messages=[Message(role=Role.USER, content="hi")],
                              est_tokens=150_000))
    # The chosen model must have a context window >= 150000.
    assert d.model.context >= 150_000


def test_router_picks_cheapest_when_prefer_cheapest():
    cfg = _kcfg()
    cfg.router.prefer_cheapest = True
    r = Router(default_catalog(), cfg)
    d = r.pick(RouterContext(messages=[Message(role=Role.USER, content="Summarize this")]))
    # Should pick a free or very cheap model.
    assert d.model.cost_in_per_m + d.model.cost_out_per_m <= 1.0 or d.model.cost_in_per_m == 0


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def test_orchestrator_disabled_picks_executor():
    cfg = _kcfg()
    cfg.orchestrator.enabled = False
    o = Orchestrator(cfg, default_catalog())
    plan = o.begin([Message(role=Role.USER, content="hi")])
    assert plan.phase == "executor"


def test_orchestrator_enabled_starts_planner():
    cfg = _kcfg()
    cfg.orchestrator.enabled = True
    o = Orchestrator(cfg, default_catalog())
    plan = o.begin([Message(role=Role.USER, content="hi")])
    assert plan.phase == "planner"
    assert "PLANNER" in (plan.system_hint or "")
