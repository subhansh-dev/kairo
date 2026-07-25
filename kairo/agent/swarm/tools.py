"""Swarm tool — exposes the sub-agent coordination as Kairo tools.

When this module is registered, the parent agent gains two new tools:

  * ``swarm_fan_out`` — fan out independent subtasks to parallel
    children, return their outputs.
  * ``swarm_pipeline`` — chain subtasks so each child's output feeds
    the next.

Both tools accept a JSON-encoded list of subtask prompts and return a
summary string the parent can read.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from kairo.agent.swarm import (
    SubTask,
    fan_out,
    pipeline,
    subtasks_from_text,
    summarize_fan_out,
)
from kairo.config import KairoConfig
from kairo.tools.base import register_all, tool
from kairo.utils import get_logger

log = get_logger("tools.swarm")


@dataclass(slots=True)
class SwarmToolsConfig:
    kairo_cfg: KairoConfig
    workspace: Path
    system_prompt: str = ""
    max_workers: int = 4


def make_swarm_tools(cfg: SwarmToolsConfig):
    """Build swarm-delegation tools bound to a parent config."""

    @tool(name="swarm_fan_out", tags=("swarm", "dangerous"))
    def swarm_fan_out(subtasks: list, max_workers: int | None = None) -> str:
        """Fan out independent subtasks to parallel child agents.

        Args:
            subtasks: List of strings (one prompt per child) OR list of
                ``{"prompt":..., "max_turns":...}`` dicts.
            max_workers: Max parallel children. Defaults to 4.

        Returns:
            A summary of each child's outcome plus their final outputs.
        """
        if not isinstance(subtasks, list):
            from kairo.errors import ToolError
            raise ToolError("swarm_fan_out", "subtasks must be a list")
        sts: list[SubTask] = []
        for i, raw in enumerate(subtasks):
            if isinstance(raw, str):
                prompt = raw
                max_t = None
            elif isinstance(raw, dict):
                prompt = str(raw.get("prompt", ""))
                max_t = raw.get("max_turns")
            else:
                from kairo.errors import ToolError
                raise ToolError("swarm_fan_out", f"subtask #{i} must be str or dict")
            sts.append(SubTask(
                id=f"fan_{i+1}",
                prompt=prompt,
                max_turns=max_t,
            ))
        if not sts:
            return "(no subtasks)"
        result = fan_out(
            sts,
            cfg.kairo_cfg,
            workspace=cfg.workspace,
            system_prompt=cfg.system_prompt,
            max_workers=max_workers or cfg.max_workers,
        )
        return summarize_fan_out(result)

    @tool(name="swarm_pipeline", tags=("swarm", "dangerous"))
    def swarm_pipeline(subtasks: list) -> str:
        """Chain subtasks so each child's output feeds the next.

        Args:
            subtasks: Ordered list of prompt strings.

        Returns:
            The final child's output, plus a trace of intermediate outputs.
        """
        if not isinstance(subtasks, list):
            from kairo.errors import ToolError
            raise ToolError("swarm_pipeline", "subtasks must be a list of strings")
        sts = []
        for i, raw in enumerate(subtasks):
            prompt = raw if isinstance(raw, str) else str(raw.get("prompt", ""))
            sts.append(SubTask(id=f"pipe_{i+1}", prompt=prompt))
        if not sts:
            return "(no subtasks)"
        result = pipeline(
            sts,
            cfg.kairo_cfg,
            workspace=cfg.workspace,
            system_prompt=cfg.system_prompt,
        )
        trace_lines = [f"Pipeline {'succeeded' if result.success else 'failed'} "
                       f"in {result.duration_s:.1f}s"]
        for r in result.results:
            tag = "OK" if r.agent_result.finish_reason == "complete" else "ERR"
            trace_lines.append(f"  [{tag}] {r.subtask.id}: {r.subtask.prompt[:80]}")
            if r.final_text:
                trace_lines.append(f"      -> {r.final_text[:200]}")
        trace_lines.append(f"\nFinal output:\n{result.final_text}")
        return "\n".join(trace_lines)

    @tool(name="swarm_split_text", tags=("swarm",))
    def swarm_split_text(text: str) -> str:
        """Parse a markdown TODO list into JSON subtask prompts.

        Useful when the parent wants to plan first (todo_set), then fan out.
        """
        sts = subtasks_from_text(text)
        return json.dumps([{"id": s.id, "prompt": s.prompt} for s in sts], indent=2)

    return [swarm_fan_out, swarm_pipeline, swarm_split_text]


def register_swarm_tools(registry, cfg: SwarmToolsConfig) -> None:
    for fn in make_swarm_tools(cfg):
        register_all(registry, fn)
