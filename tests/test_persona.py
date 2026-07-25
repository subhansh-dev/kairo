"""Tests for kairo.agent.persona — soul.md loading."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.agent.persona import Persona, default_persona, load_persona
from kairo.errors import ConfigError


def test_load_persona_without_front_matter(tmp_path: Path):
    p = tmp_path / "soul.md"
    p.write_text("# Identity\n\nYou are Kairo.\n")
    persona = load_persona(p)
    assert persona.name == "soul"  # falls back to filename
    assert "You are Kairo" in persona.body
    assert persona.metadata == {}


def test_load_persona_with_front_matter(tmp_path: Path):
    p = tmp_path / "soul.md"
    p.write_text(
        "---\n"
        "name: kairo\n"
        "version: 0.2.0\n"
        "tags: [coding, free-models]\n"
        "---\n"
        "# Identity\n\nYou are Kairo.\n"
    )
    persona = load_persona(p)
    assert persona.name == "kairo"
    assert persona.metadata["version"] == "0.2.0"
    assert persona.metadata["tags"] == ["coding", "free-models"]
    assert "You are Kairo" in persona.body


def test_load_persona_invalid_yaml_falls_back_gracefully(tmp_path: Path):
    p = tmp_path / "soul.md"
    p.write_text(
        "---\n"
        "name: [unterminated\n"
        "---\n"
        "Body content here.\n"
    )
    persona = load_persona(p)
    # Body is still loaded.
    assert "Body content" in persona.body


def test_load_persona_missing_file(tmp_path: Path):
    with pytest.raises(ConfigError):
        load_persona(tmp_path / "nonexistent.md")


def test_persona_system_prompt_without_metadata(tmp_path: Path):
    persona = Persona(name="x", body="Hello", metadata={"version": "1"})
    assert persona.system_prompt() == "Hello"


def test_persona_system_prompt_with_metadata(tmp_path: Path):
    persona = Persona(name="x", body="Hello", metadata={"version": "1"})
    prompt = persona.system_prompt(with_metadata=True)
    assert "Hello" in prompt
    assert "version" in prompt
    assert "1" in prompt


def test_default_persona_has_body():
    p = default_persona()
    assert p.name == "kairo"
    assert len(p.body) > 100
    assert "Kairo" in p.body
