"""Agent persona — load a system prompt from a soul.md file.

Inspired by the pattern of giving an agent a "soul" file that
describes its identity, values, and behavioural guidelines. The file
is a plain markdown file with optional YAML front-matter for
structured metadata.

Example ``soul.md``::

    ---
    name: kairo
    version: 0.2.0
    tags: [coding, free-models, multi-model]
    ---

    # Identity

    You are Kairo, a coding agent built to run on free local models.

    # Values

    - Be concise. Do not repeat yourself.
    - Always read a file before editing it.
    - When stuck, decompose the problem before retrying.

    # Style

    Use `todo_set` to plan multi-step tasks. Use `swarm_fan_out` for
    independent subtasks.

The front-matter is parsed and exposed as ``Persona.metadata``; the
body is exposed as ``Persona.body`` and used as the system prompt.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from kairo.errors import ConfigError
from kairo.utils import get_logger

log = get_logger("agent.persona")


@dataclass(slots=True)
class Persona:
    """An agent persona loaded from a soul.md file."""

    name: str
    body: str
    metadata: dict[str, Any] = field(default_factory=dict)
    source_path: Path | None = None

    def system_prompt(self, *, with_metadata: bool = False) -> str:
        """Return the body as a system prompt.

        When ``with_metadata=True`` the front-matter is included as a
        header block — useful for debugging or for agents that should
        be aware of their own version.
        """
        if not with_metadata:
            return self.body
        meta_str = yaml.safe_dump(self.metadata, sort_keys=False).strip()
        return f"<!-- persona metadata:\n{meta_str}\n-->\n\n{self.body}"


_FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?\n)---\s*\n", re.DOTALL)


def load_persona(path: str | Path) -> Persona:
    """Load a persona from a soul.md file.

    The file may have optional YAML front-matter delimited by ``---``.
    """
    p = Path(path)
    if not p.is_file():
        raise ConfigError(f"persona file not found: {p}")
    text = p.read_text(encoding="utf-8")
    metadata: dict[str, Any] = {}
    body = text
    m = _FRONT_MATTER_RE.match(text)
    if m:
        try:
            loaded = yaml.safe_load(m.group(1))
            if isinstance(loaded, dict):
                metadata = loaded
        except yaml.YAMLError as exc:
            log.warning("could not parse persona front-matter: %s", exc)
        body = text[m.end():]
    name = str(metadata.get("name", p.stem))
    return Persona(name=name, body=body.strip(), metadata=metadata, source_path=p)


def default_persona() -> Persona:
    """Build a default Kairo persona for when no soul.md is provided."""
    body = """You are Kairo, a coding agent built to run on free local models.

# Identity

You are a careful, methodical coding agent. You prefer to decompose
problems before acting, and you use the `todo_set` tool to plan multi-
step tasks. You read files before editing them and you verify your
changes with shell or test commands when possible.

# Values

- Be concise. Do not repeat yourself.
- Always read a file before editing it.
- When a tool call fails, do not retry it with the same arguments —
  change your approach.
- Use `swarm_fan_out` for independent subtasks and `swarm_pipeline`
  for dependent ones.
- When stuck, write a TODO list before retrying.

# Style

- Prefer specific, low-risk edits over large rewrites.
- Use `edit_file` for surgical changes; reserve `write_file` for new
  files or full rewrites.
- Use `grep` and `find_references` before reading files to locate
  relevant code quickly.
- Run tests after changes when a test suite exists.
"""
    return Persona(name="kairo", body=body, metadata={"version": "0.2.0"})
