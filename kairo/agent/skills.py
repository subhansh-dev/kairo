"""Agent skills — reusable instruction + tool bundles (SKILL.md format).

Inspired by Claude's agent-skills pattern: a "skill" is a directory
containing a ``SKILL.md`` file with front-matter describing when to
use it, plus optional scripts and resources. The agent loads skills
on demand based on the current task.

Directory layout::

    skills/
    ├── pdf-export/
    │   ├── SKILL.md        # front-matter + instructions
    │   ├── export.py       # helper script
    │   └── template.html   # resource
    ├── email-digest/
    │   ├── SKILL.md
    │   └── digest.py

SKILL.md format::

    ---
    name: pdf-export
    description: Export a document to PDF using ReportLab.
    trigger:
      - convert to pdf
      - export pdf
      - save as pdf
    tools:
      - shell
      - write_file
    ---

    # How to export a PDF

    1. Read the source document.
    2. Run ``python scripts/export.py <input> <output.pdf>``.
    3. Verify the PDF exists.

This module:
  * Discovers skills in a configured skills directory.
  * Matches skills to a task by trigger keywords.
  * Injects the skill's instructions into the system prompt.
  * Optionally registers the skill's tools in the agent's registry.
"""

from __future__ import annotations

import importlib.util
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from kairo.errors import KairoError
from kairo.tools.base import ToolRegistry, register_all, tool
from kairo.utils import get_logger

log = get_logger("agent.skills")


@dataclass(slots=True)
class Skill:
    """A loaded agent skill."""

    name: str
    description: str
    triggers: list[str] = field(default_factory=list)
    required_tools: list[str] = field(default_factory=list)
    body: str = ""
    source_path: Path | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def matches(self, query: str) -> bool:
        """Return True if any trigger keyword appears in ``query``."""
        q = query.lower()
        return any(t.lower() in q for t in self.triggers)

    def match_score(self, query: str) -> int:
        """Count how many triggers match (higher = better)."""
        q = query.lower()
        return sum(1 for t in self.triggers if t.lower() in q)

    def system_prompt_section(self) -> str:
        """Render the skill's instructions as a system-prompt section."""
        lines = [
            f"# Skill: {self.name}",
            self.description,
            "",
            self.body,
        ]
        return "\n".join(lines)


_FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?\n)---\s*\n", re.DOTALL)


def load_skill(skill_dir: str | Path) -> Skill:
    """Load a skill from a directory containing SKILL.md."""
    skill_dir = Path(skill_dir)
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        raise KairoError(f"no SKILL.md in {skill_dir}")
    text = skill_md.read_text(encoding="utf-8")
    metadata: dict[str, Any] = {}
    body = text
    m = _FRONT_MATTER_RE.match(text)
    if m:
        try:
            loaded = yaml.safe_load(m.group(1))
            if isinstance(loaded, dict):
                metadata = loaded
        except yaml.YAMLError as exc:
            log.warning("could not parse skill front-matter in %s: %s", skill_md, exc)
        body = text[m.end():]
    name = str(metadata.get("name", skill_dir.name))
    description = str(metadata.get("description", ""))
    triggers_raw = metadata.get("trigger", [])
    if isinstance(triggers_raw, str):
        triggers = [triggers_raw]
    elif isinstance(triggers_raw, list):
        triggers = [str(t) for t in triggers_raw]
    else:
        triggers = []
    tools_raw = metadata.get("tools", [])
    if isinstance(tools_raw, str):
        required_tools = [tools_raw]
    elif isinstance(tools_raw, list):
        required_tools = [str(t) for t in tools_raw]
    else:
        required_tools = []
    return Skill(
        name=name,
        description=description,
        triggers=triggers,
        required_tools=required_tools,
        body=body.strip(),
        source_path=skill_dir,
        metadata=metadata,
    )


class SkillLoader:
    """Discovers and serves skills from a directory.

    Usage::

        loader = SkillLoader(Path("./skills"))
        loader.discover()
        matches = loader.find_relevant("export this to pdf")
        for skill in matches:
            print(skill.system_prompt_section())
    """

    def __init__(self, skills_dir: Path | None = None) -> None:
        self.skills_dir = skills_dir
        self.skills: dict[str, Skill] = {}

    def discover(self) -> list[Skill]:
        """Scan ``skills_dir`` for skill subdirectories."""
        if self.skills_dir is None or not self.skills_dir.is_dir():
            return []
        self.skills.clear()
        for sub in sorted(self.skills_dir.iterdir()):
            if not sub.is_dir():
                continue
            if (sub / "SKILL.md").is_file():
                try:
                    skill = load_skill(sub)
                    self.skills[skill.name] = skill
                except Exception as exc:  # noqa: BLE001
                    log.warning("could not load skill from %s: %s", sub, exc)
        return list(self.skills.values())

    def get(self, name: str) -> Skill | None:
        return self.skills.get(name)

    def find_relevant(self, query: str, *, limit: int = 3) -> list[Skill]:
        """Find skills whose triggers match ``query``, sorted by match count."""
        scored: list[tuple[int, Skill]] = []
        for skill in self.skills.values():
            score = skill.match_score(query)
            if score > 0:
                scored.append((score, skill))
        scored.sort(key=lambda x: -x[0])
        return [s for _, s in scored[:limit]]

    def load_skill_tools(self, skill: Skill, registry: ToolRegistry) -> list[str]:
        """Load a skill's helper scripts as Kairo tools.

        Looks for ``scripts.py`` (or any ``*.py``) inside the skill
        directory and registers its top-level functions as tools.
        """
        if skill.source_path is None:
            return []
        registered: list[str] = []
        for py_file in sorted(skill.source_path.glob("*.py")):
            try:
                spec = importlib.util.spec_from_file_location(
                    f"skill_{skill.name}_{py_file.stem}", py_file,
                )
                if spec is None or spec.loader is None:
                    continue
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                # Find @tool-decorated functions.
                for name in dir(mod):
                    fn = getattr(mod, name)
                    if callable(fn) and hasattr(fn, "_kairo_spec"):
                        register_all(registry, fn)
                        registered.append(fn._kairo_spec["name"])
            except Exception as exc:  # noqa: BLE001
                log.warning("could not load skill script %s: %s", py_file, exc)
        return registered

    def all_skills(self) -> list[Skill]:
        return list(self.skills.values())
