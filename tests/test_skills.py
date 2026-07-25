"""Tests for kairo.agent.skills — skill loader."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.agent.skills import Skill, SkillLoader, load_skill
from kairo.tools.base import ToolRegistry


def _make_skill_dir(tmp_path: Path, name: str, content: str) -> Path:
    d = tmp_path / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(content)
    return d


def test_load_skill_with_front_matter(tmp_path: Path):
    d = _make_skill_dir(tmp_path, "pdf-export", """---
name: pdf-export
description: Export a document to PDF.
trigger:
  - convert to pdf
  - export pdf
tools:
  - shell
  - write_file
---

# How to export a PDF

1. Read the source.
2. Run export.py.
""")
    skill = load_skill(d)
    assert skill.name == "pdf-export"
    assert skill.description == "Export a document to PDF."
    assert "convert to pdf" in skill.triggers
    assert "shell" in skill.required_tools
    assert "How to export a PDF" in skill.body


def test_load_skill_without_front_matter(tmp_path: Path):
    d = _make_skill_dir(tmp_path, "simple", """# Simple skill

Just instructions.
""")
    skill = load_skill(d)
    assert skill.name == "simple"  # falls back to dir name
    assert skill.description == ""
    assert skill.triggers == []
    assert "Simple skill" in skill.body


def test_skill_matches(tmp_path: Path):
    skill = Skill(
        name="x", description="d",
        triggers=["convert to pdf", "export pdf"],
    )
    assert skill.matches("please convert to pdf") is True
    assert skill.matches("do something else") is False


def test_skill_match_score(tmp_path: Path):
    skill = Skill(
        name="x", description="d",
        triggers=["pdf", "convert"],
    )
    assert skill.match_score("convert to pdf") == 2
    assert skill.match_score("convert only") == 1
    assert skill.match_score("nothing") == 0


def test_skill_system_prompt_section(tmp_path: Path):
    skill = Skill(
        name="x", description="A skill",
        body="Step 1. Do thing.",
    )
    section = skill.system_prompt_section()
    assert "Skill: x" in section
    assert "A skill" in section
    assert "Step 1" in section


def test_skill_loader_discover(tmp_path: Path):
    _make_skill_dir(tmp_path, "a", "---\nname: a\ndescription: d\n---\nbody")
    _make_skill_dir(tmp_path, "b", "---\nname: b\ndescription: d\n---\nbody")
    # Non-skill dir (no SKILL.md)
    (tmp_path / "not-a-skill").mkdir()
    loader = SkillLoader(tmp_path)
    skills = loader.discover()
    assert len(skills) == 2
    assert {s.name for s in skills} == {"a", "b"}


def test_skill_loader_find_relevant(tmp_path: Path):
    _make_skill_dir(tmp_path, "pdf", """---
name: pdf
description: d
trigger:
  - pdf
  - export
---
body""")
    _make_skill_dir(tmp_path, "email", """---
name: email
description: d
trigger:
  - email
  - send
---
body""")
    loader = SkillLoader(tmp_path)
    loader.discover()
    matches = loader.find_relevant("please export this to pdf")
    assert len(matches) >= 1
    assert matches[0].name == "pdf"


def test_skill_loader_get(tmp_path: Path):
    _make_skill_dir(tmp_path, "x", "---\nname: x\ndescription: d\n---\nbody")
    loader = SkillLoader(tmp_path)
    loader.discover()
    assert loader.get("x") is not None
    assert loader.get("nope") is None


def test_skill_loader_no_dir():
    loader = SkillLoader(None)
    skills = loader.discover()
    assert skills == []


def test_skill_loader_load_skill_tools(tmp_path: Path):
    """Skill with a Python script gets its tools registered."""
    skill_dir = tmp_path / "with-script"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("""---
name: with-script
description: d
---
body""")
    (skill_dir / "helper.py").write_text("""
from kairo.tools.base import tool

@tool(name="helper_greet")
def greet(name: str) -> str:
    '''Greet someone.'''
    return f"Hello {name}!"
""")
    loader = SkillLoader(tmp_path)
    loader.discover()
    skill = loader.get("with-script")
    assert skill is not None
    reg = ToolRegistry()
    registered = loader.load_skill_tools(skill, reg)
    assert "helper_greet" in registered
    assert reg.has("helper_greet")
