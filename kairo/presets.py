"""Agent presets — ready-to-use configurations for common agent types.

Building an agent from scratch requires picking a persona, configuring
the router, choosing tools, etc. This module provides pre-built presets
for common use cases so you can spin up a coding agent / research agent
/ data analyst agent with one line.

Built-in presets:
  * :class:`CodingAgentPreset` — coding-focused persona, SWE tools,
    shell access, prefer coding-tuned models.
  * :class:`ResearchAgentPreset` — research-focused persona, web tools,
    code-RAG, prefer long-context models.
  * :class:`DataAnalystPreset` — data-analysis persona, run_python +
    shell, prefer models with strong reasoning.
  * :class:`ReviewerPreset` — code-review persona, read-only tools
    only, prefer review-capable models.
  * :class:`MinimalPreset` — bare-bones agent with just file ops + edit.

Each preset produces an :class:`AgentConfig` + a KairoConfig override
+ a list of tool-bundle flags. Apply with :meth:`Preset.apply` or
build the agent directly with :meth:`Preset.build_agent`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kairo.agent import Agent, AgentConfig, default_persona
from kairo.agent.persona import Persona
from kairo.config import KairoConfig
from kairo.tools import ToolBundleConfig


@dataclass(slots=True)
class Preset:
    """Base class for agent presets."""

    name: str
    description: str
    persona_body: str
    # Tool bundle flags.
    enable_file: bool = True
    enable_edit: bool = True
    enable_search: bool = True
    enable_shell: bool = True
    enable_web: bool = True
    enable_todo: bool = True
    enable_swe: bool = True
    enable_web_design: bool = False
    enable_code_rag: bool = True
    enable_browser: bool = False
    # Router overrides.
    prefer_capabilities: tuple[str, ...] = ()
    prefer_provider: str | None = None
    prefer_model: str | None = None
    max_turns: int = 40
    # Extra metadata.
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_persona(self) -> Persona:
        return Persona(name=self.name, body=self.persona_body,
                        metadata={"preset": self.name, **self.metadata})

    def to_agent_config(self, workspace: Path) -> AgentConfig:
        return AgentConfig(
            workspace=workspace,
            system_prompt=self.persona_body,
            max_turns=self.max_turns,
        )

    def to_bundle_config(self, workspace: Path) -> ToolBundleConfig:
        return ToolBundleConfig(
            workspace=workspace,
            enable_file=self.enable_file,
            enable_edit=self.enable_edit,
            enable_search=self.enable_search,
            enable_shell=self.enable_shell,
            enable_web=self.enable_web,
            enable_todo=self.enable_todo,
            enable_swe=self.enable_swe,
            enable_web_design=self.enable_web_design,
            enable_code_rag=self.enable_code_rag,
            enable_browser=self.enable_browser,
        )

    def apply_to_kairo_config(self, cfg: KairoConfig) -> KairoConfig:
        """Return a modified copy of cfg with this preset's router overrides."""
        import copy
        new_cfg = copy.deepcopy(cfg)
        if self.prefer_provider and self.prefer_model:
            if self.prefer_provider in new_cfg.providers:
                new_cfg.providers[self.prefer_provider].default_model = self.prefer_model
            new_cfg.router.default_model = f"{self.prefer_provider}:{self.prefer_model}"
        new_cfg.safety.max_turns = self.max_turns
        return new_cfg

    def build_agent(self, kairo_cfg: KairoConfig, workspace: Path) -> Agent:
        """Build a ready-to-run Agent with this preset's configuration."""
        agent_cfg = self.to_agent_config(workspace)
        return Agent(self.apply_to_kairo_config(kairo_cfg), agent_cfg)


# ---------------------------------------------------------------------------
# Built-in presets
# ---------------------------------------------------------------------------

CODING_AGENT = Preset(
    name="coding-agent",
    description="General-purpose coding agent with file ops, edit, search, shell, SWE tools.",
    persona_body="""You are Kairo, a coding agent. You write, edit, and debug code.

# Workflow

1. Understand the task. If unclear, ask for clarification.
2. Use `grep` / `find_references` / `code_search` to locate relevant code.
3. Read the relevant files with `read_file`.
4. Make surgical edits with `edit_file`. Use `write_file` only for new files.
5. Verify changes with `shell` (run tests, type-check, lint).
6. Call `self_status` if you need to know your remaining budget.

# Rules

- Always read before editing.
- Don't repeat failed tool calls — change your approach.
- Use `edit_file` over `write_file` for surgical changes.
- Run tests after changes when a test suite exists.
- Be concise. Don't restate the task.
""",
    enable_file=True, enable_edit=True, enable_search=True,
    enable_shell=True, enable_web=True, enable_todo=True,
    enable_swe=True, enable_web_design=False, enable_code_rag=True,
    prefer_capabilities=("code", "tools"),
    max_turns=40,
)


RESEARCH_AGENT = Preset(
    name="research-agent",
    description="Research agent with web tools, code-RAG, and long-context preference.",
    persona_body="""You are Kairo, a research agent. You gather, synthesize, and summarize information.

# Workflow

1. Use `web_search` / `web_fetch` to find primary sources.
2. Use `code_search` to find relevant code in the workspace.
3. Cross-reference multiple sources before drawing conclusions.
4. Cite sources by URL or file:line.
5. Summarize findings in a structured format (headings + bullets).

# Rules

- Prefer primary sources over secondary.
- Distinguish facts from speculation.
- Note when information is outdated or contradictory.
- Be concise but complete — don't omit critical caveats.
""",
    enable_file=True, enable_edit=False, enable_search=True,
    enable_shell=False, enable_web=True, enable_todo=True,
    enable_swe=False, enable_web_design=False, enable_code_rag=True,
    prefer_capabilities=("long-context",),
    max_turns=30,
)


DATA_ANALYST = Preset(
    name="data-analyst",
    description="Data analyst with run_python, shell, and reasoning-model preference.",
    persona_body="""You are Kairo, a data analyst. You analyze datasets and produce insights.

# Workflow

1. Inspect the data with `run_python` (pandas, numpy available).
2. Clean and transform as needed.
3. Compute summary statistics.
4. Generate visualizations when useful.
5. Report findings in a clear, structured format.

# Rules

- Show your work — include the code you ran.
- Note assumptions and limitations.
- Don't cherry-pick — report negative findings too.
- Prefer simple analyses over complex ones.
""",
    enable_file=True, enable_edit=True, enable_search=True,
    enable_shell=True, enable_web=False, enable_todo=True,
    enable_swe=False, enable_web_design=False, enable_code_rag=False,
    prefer_capabilities=("reason", "code"),
    max_turns=30,
)


REVIEWER = Preset(
    name="reviewer",
    description="Code reviewer with read-only tools (no editing, no shell).",
    persona_body="""You are Kairo, a code reviewer. You read code and provide feedback.

# Workflow

1. Use `get_signature` / `get_call_graph` to understand structure.
2. Use `read_file` to read the code in detail.
3. Identify issues: bugs, security, performance, style.
4. Suggest specific fixes (cite file:line).
5. Approve if no significant issues remain.

# Rules

- Be specific — cite file:line for every issue.
- Distinguish must-fix from nice-to-have.
- Don't suggest stylistic rewrites without justification.
- Acknowledge what's done well, not just problems.
""",
    enable_file=True, enable_edit=False, enable_search=True,
    enable_shell=False, enable_web=False, enable_todo=False,
    enable_swe=True, enable_web_design=False, enable_code_rag=True,
    prefer_capabilities=("code",),
    max_turns=20,
)


MINIMAL = Preset(
    name="minimal",
    description="Bare-bones agent with just file ops + edit. No shell, no web, no SWE.",
    persona_body="""You are Kairo, a minimal coding agent. You can read and edit files.

# Rules

- Read before editing.
- Be concise.
- Use `edit_file` for surgical changes.
""",
    enable_file=True, enable_edit=True, enable_search=False,
    enable_shell=False, enable_web=False, enable_todo=False,
    enable_swe=False, enable_web_design=False, enable_code_rag=False,
    max_turns=15,
)


# Registry of built-in presets.
PRESETS: dict[str, Preset] = {
    "coding-agent": CODING_AGENT,
    "research-agent": RESEARCH_AGENT,
    "data-analyst": DATA_ANALYST,
    "reviewer": REVIEWER,
    "minimal": MINIMAL,
}


def get_preset(name: str) -> Preset:
    """Look up a preset by name."""
    if name not in PRESETS:
        raise KeyError(f"unknown preset: {name!r}. Available: {list(PRESETS.keys())}")
    return PRESETS[name]


def list_presets() -> list[str]:
    return sorted(PRESETS.keys())
