"""Tests for kairo.agent.memory_types — episodic + semantic + procedural."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from kairo.agent.memory_types import (
    AgentMemory,
    EpisodicEvent,
    EpisodicMemory,
    ProceduralMemory,
    ProceduralSkill,
    SemanticFact,
    SemanticMemory,
)


# ---------------------------------------------------------------------------
# Episodic memory
# ---------------------------------------------------------------------------

def test_episodic_record_and_recent(tmp_path: Path):
    mem = EpisodicMemory(tmp_path / "e.json")
    mem.record("tool_call", "called read_file", path="foo.py")
    mem.record("tool_result", "got content", path="foo.py")
    recent = mem.recent(n=10)
    assert len(recent) == 2
    assert recent[0].kind == "tool_call"
    assert recent[1].kind == "tool_result"


def test_episodic_recent_filtered_by_kind(tmp_path: Path):
    mem = EpisodicMemory(tmp_path / "e.json")
    mem.record("tool_call", "a")
    mem.record("error", "b")
    mem.record("tool_call", "c")
    calls = mem.recent(n=10, kind="tool_call")
    assert len(calls) == 2
    assert all(e.kind == "tool_call" for e in calls)


def test_episodic_since(tmp_path: Path):
    mem = EpisodicMemory(tmp_path / "e.json")
    mem.record("x", "before")
    cutoff = time.time()
    time.sleep(0.01)
    mem.record("x", "after")
    after = mem.since(cutoff)
    assert len(after) == 1
    assert after[0].summary == "after"


def test_episodic_persists(tmp_path: Path):
    p = tmp_path / "e.json"
    mem = EpisodicMemory(p)
    mem.record("x", "hello")
    mem2 = EpisodicMemory(p)
    assert len(mem2.recent()) == 1
    assert mem2.recent()[0].summary == "hello"


def test_episodic_caps_at_1000(tmp_path: Path):
    mem = EpisodicMemory(tmp_path / "e.json")
    for i in range(1100):
        mem.record("x", f"event {i}")
    assert len(mem.recent(n=2000)) == 1000


# ---------------------------------------------------------------------------
# Semantic memory
# ---------------------------------------------------------------------------

def test_semantic_add_and_query(tmp_path: Path):
    mem = SemanticMemory(tmp_path / "s.json")
    mem.add("foo.py", "contains_function", "bar")
    mem.add("foo.py", "contains_function", "baz")
    mem.add("bar.py", "contains_class", "Foo")
    results = mem.query(subject="foo.py", predicate="contains_function")
    assert len(results) == 2
    assert {f.object for f in results} == {"bar", "baz"}


def test_semantic_dedupes(tmp_path: Path):
    mem = SemanticMemory(tmp_path / "s.json")
    mem.add("foo.py", "contains_function", "bar")
    mem.add("foo.py", "contains_function", "bar")  # same triple
    assert len(mem.query(subject="foo.py")) == 1


def test_semantic_remove(tmp_path: Path):
    mem = SemanticMemory(tmp_path / "s.json")
    mem.add("foo.py", "contains_function", "bar")
    assert mem.remove("foo.py", "contains_function", "bar") is True
    assert mem.query(subject="foo.py") == []
    # Removing again returns False.
    assert mem.remove("foo.py", "contains_function", "bar") is False


def test_semantic_search_text(tmp_path: Path):
    mem = SemanticMemory(tmp_path / "s.json")
    mem.add("auth_module", "contains_function", "login")
    mem.add("billing_module", "contains_function", "charge")
    results = mem.search_text("auth login")
    assert len(results) >= 1
    assert any(r.subject == "auth_module" for r in results)


def test_semantic_persists(tmp_path: Path):
    p = tmp_path / "s.json"
    mem = SemanticMemory(p)
    mem.add("a", "b", "c")
    mem2 = SemanticMemory(p)
    assert len(mem2.query(subject="a")) == 1


# ---------------------------------------------------------------------------
# Procedural memory
# ---------------------------------------------------------------------------

def test_procedural_add_and_get(tmp_path: Path):
    mem = ProceduralMemory(tmp_path / "p.json")
    skill = ProceduralSkill(
        id="s1", name="fix_syntax_error",
        description="How to fix a Python SyntaxError",
        trigger="python syntax error in file",
        steps=["read_file", "find the line", "edit_file with corrected syntax"],
    )
    mem.add(skill)
    assert mem.get("s1") is skill


def test_procedural_find_by_trigger(tmp_path: Path):
    mem = ProceduralMemory(tmp_path / "p.json")
    mem.add(ProceduralSkill(
        id="s1", name="fix_syntax",
        description="Fix Python SyntaxError",
        trigger="python syntax error in file",
        steps=["read", "fix", "edit"],
    ))
    mem.add(ProceduralSkill(
        id="s2", name="fix_test_failure",
        description="Fix a failing pytest",
        trigger="pytest test failure",
        steps=["run pytest", "read failing test", "fix code"],
    ))
    results = mem.find_by_trigger("how to fix python syntax error")
    assert len(results) >= 1
    assert results[0].id == "s1"


def test_procedural_record_use(tmp_path: Path):
    mem = ProceduralMemory(tmp_path / "p.json")
    mem.add(ProceduralSkill(
        id="s1", name="x", description="d", trigger="t", steps=["a"]
    ))
    mem.record_use("s1")
    mem.record_use("s1")
    assert mem.get("s1").use_count == 2
    assert mem.get("s1").last_used_ts > 0


def test_procedural_persists(tmp_path: Path):
    p = tmp_path / "p.json"
    mem = ProceduralMemory(p)
    mem.add(ProceduralSkill(
        id="s1", name="x", description="d", trigger="t", steps=["a"]
    ))
    mem2 = ProceduralMemory(p)
    assert mem2.get("s1") is not None


# ---------------------------------------------------------------------------
# AgentMemory (combined)
# ---------------------------------------------------------------------------

def test_agent_memory_load_creates_dirs(tmp_path: Path):
    am = AgentMemory.load(tmp_path)
    assert (tmp_path / "memory").is_dir()
    assert (tmp_path / "memory" / "episodic.json").parent.exists()


def test_agent_memory_recall_combines_all(tmp_path: Path):
    am = AgentMemory.load(tmp_path)
    am.episodic.record("tool_call", "called read_file", path="foo.py")
    am.semantic.add("foo.py", "contains_function", "bar")
    am.procedural.add(ProceduralSkill(
        id="s1", name="fix_bug",
        description="Fix a bug in foo.py",
        trigger="bug in foo.py",
        steps=["read foo.py", "locate the bug", "edit_file"],
    ))
    context = am.recall("bug in foo.py")
    assert "read_file" in context  # from episodic
    assert "foo.py" in context  # from semantic
    assert "fix_bug" in context  # from procedural


def test_agent_memory_recall_empty(tmp_path: Path):
    am = AgentMemory.load(tmp_path)
    context = am.recall("anything")
    assert "no relevant" in context.lower()
