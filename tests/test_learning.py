"""Tests for kairo.agent.learning — persistent learning graph."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.agent.learning import LearningGraph, LearningEntry


def test_load_empty_workdir(tmp_path: Path):
    g = LearningGraph.load(tmp_path)
    assert g.entries == []
    assert g.stats()["entry_count"] == 0


def test_record_success_persists(tmp_path: Path):
    g = LearningGraph.load(tmp_path, autosave=True)
    g.record_success(
        prompt="Write a hello world app",
        system_prompt="",
        model="glm-4.6",
        provider="glm",
        tools_used=["write_file", "shell"],
        tool_call_count=2,
        final_text="Done!",
        duration_s=5.0,
        tokens=1000,
    )
    # Reload from disk.
    g2 = LearningGraph.load(tmp_path)
    assert len(g2.entries) == 1
    e = g2.entries[0]
    assert e.model == "glm-4.6"
    assert e.provider == "glm"
    assert e.tools_used == ["write_file", "shell"]
    assert e.final_text_preview == "Done!"


def test_record_success_dedupes_same_prompt(tmp_path: Path):
    g = LearningGraph.load(tmp_path, autosave=True)
    for _ in range(3):
        g.record_success(
            prompt="same prompt",
            system_prompt="same sys",
            model="m", provider="p", tools_used=["t"],
            tool_call_count=1, final_text="x", duration_s=1, tokens=1,
        )
    assert len(g.entries) == 1


def test_find_similar_returns_matches(tmp_path: Path):
    g = LearningGraph.load(tmp_path, autosave=True)
    g.record_success(
        prompt="Write a FastAPI app with a health check endpoint",
        system_prompt="", model="m", provider="p",
        tools_used=["write_file"], tool_call_count=1,
        final_text="ok", duration_s=1, tokens=1,
    )
    g.record_success(
        prompt="Refactor the auth module",
        system_prompt="", model="m", provider="p",
        tools_used=["edit_file"], tool_call_count=1,
        final_text="ok", duration_s=1, tokens=1,
    )
    matches = g.find_similar("Write a FastAPI service with health endpoint")
    assert len(matches) >= 1
    # The fastapi-related entry should rank first.
    assert "fastapi" in matches[0].prompt_preview.lower()


def test_find_similar_returns_empty_when_no_match(tmp_path: Path):
    g = LearningGraph.load(tmp_path, autosave=True)
    g.record_success(
        prompt="Refactor the auth module",
        system_prompt="", model="m", provider="p",
        tools_used=["edit_file"], tool_call_count=1,
        final_text="ok", duration_s=1, tokens=1,
    )
    matches = g.find_similar("completely different topic about cooking pasta")
    assert matches == []


def test_hint_for_returns_string(tmp_path: Path):
    g = LearningGraph.load(tmp_path, autosave=True)
    g.record_success(
        prompt="Write a FastAPI app",
        system_prompt="", model="glm-4.6", provider="glm",
        tools_used=["write_file", "shell"], tool_call_count=2,
        final_text="Done", duration_s=3.5, tokens=500,
    )
    hint = g.hint_for("Write a FastAPI service")
    assert hint is not None
    assert "glm-4.6" in hint
    assert "write_file" in hint


def test_hint_for_returns_none_when_empty(tmp_path: Path):
    g = LearningGraph.load(tmp_path)
    assert g.hint_for("anything") is None


def test_stats(tmp_path: Path):
    g = LearningGraph.load(tmp_path, autosave=True)
    g.record_success(
        prompt="task 1", system_prompt="s",
        model="m1", provider="p1", tools_used=["a", "b"],
        tool_call_count=2, final_text="x", duration_s=1, tokens=1,
    )
    g.record_success(
        prompt="task 2", system_prompt="s",
        model="m2", provider="p2", tools_used=["a", "c"],
        tool_call_count=2, final_text="x", duration_s=1, tokens=1,
    )
    stats = g.stats()
    assert stats["entry_count"] == 2
    assert stats["unique_prompts"] == 2
    assert "p1:m1" in stats["models_used"]
    assert "p2:m2" in stats["models_used"]
    # "a" was used in both entries.
    top = dict(stats["most_used_tools"])
    assert top["a"] == 2


def test_autosave_off_does_not_persist(tmp_path: Path):
    g = LearningGraph.load(tmp_path, autosave=False)
    g.record_success(
        prompt="x", system_prompt="",
        model="m", provider="p", tools_used=["t"],
        tool_call_count=1, final_text="x", duration_s=1, tokens=1,
    )
    # Without autosave, the file shouldn't exist yet.
    assert not (tmp_path / "learning_graph.json").exists()
    g.save()
    assert (tmp_path / "learning_graph.json").exists()
