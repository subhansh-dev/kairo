"""Sub-agent coordination — fan out subtasks to parallel Kairo agents.

When a task is big enough that a single agent would either hit the
loop limit or burn the context window, the swarm module lets a parent
agent delegate subtasks to child agents that run in parallel. Each
child gets its own clean context, its own tool registry, and its own
provider budget — so a 50-step refactor becomes 5 x 10-step child
agents running concurrently.

Two coordination patterns:

  * **Fan-out / fan-in** (``fan_out``): parent hands N independent
    subtasks to N children, collects their results, and synthesizes a
    final answer. Used when subtasks are independent (e.g. "write
    tests for files A, B, C").

  * **Pipeline** (``pipeline``): parent hands subtasks to children in
    sequence, where each child's output feeds the next child's input.
    Used when subtasks are dependent (e.g. "find bug -> write fix ->
    write tests").

A third pattern — **tree-search** — is implemented in
:mod:`kairo.agent.swarm.tree_search` and lets the parent explore
multiple approaches in parallel and pick the best one (a la AlphaCode).
"""

from __future__ import annotations

import concurrent.futures as cf
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig
from kairo.errors import KairoError
from kairo.types import AgentResult, Message, Role
from kairo.utils import EventKind, emit, get_logger

log = get_logger("agent.swarm")


@dataclass(slots=True)
class SubTask:
    """A single subtask delegated to a child agent."""

    id: str
    prompt: str
    # Optional workspace override. When None, inherits the parent's.
    workspace: Path | None = None
    # Optional system-prompt override.
    system_prompt: str | None = None
    # Optional max-turns override.
    max_turns: int | None = None
    # Free-form metadata (e.g. {"phase": "tests"}).
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class SubTaskResult:
    """Result of running a single subtask."""

    subtask: SubTask
    agent_result: AgentResult
    # The final assistant text from the child (convenience).
    final_text: str = ""


def _extract_final_text(result: AgentResult) -> str:
    for m in reversed(result.messages):
        if m.role == Role.ASSISTANT and m.content:
            return m.content
    return ""


def _run_subtask(
    subtask: SubTask,
    kairo_cfg: KairoConfig,
    parent_workspace: Path,
    parent_system_prompt: str,
) -> SubTaskResult:
    """Run one subtask in a fresh Agent. Designed to run in a worker thread."""
    workspace = subtask.workspace or parent_workspace
    sys_prompt = subtask.system_prompt or parent_system_prompt
    agent_cfg = AgentConfig(
        workspace=workspace,
        system_prompt=sys_prompt,
        max_turns=subtask.max_turns,
    )
    # Tag the run with the subtask id so the session store can be
    # correlated back to the parent run.
    agent = Agent(kairo_cfg, agent_cfg)
    emit(
        EventKind.TOOL_CALL,
        name="swarm.subtask.start",
        args={"subtask_id": subtask.id, "prompt": subtask.prompt[:200]},
    )
    result = agent.run(subtask.prompt)
    final = _extract_final_text(result)
    emit(
        EventKind.TOOL_RESULT,
        name="swarm.subtask.end",
        ok=result.finish_reason == "complete",
        args={"subtask_id": subtask.id, "finish": result.finish_reason},
    )
    return SubTaskResult(subtask=subtask, agent_result=result, final_text=final)


# ---------------------------------------------------------------------------
# Fan-out / fan-in
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class FanOutResult:
    """Outcome of a fan-out run."""

    results: list[SubTaskResult]
    # Wall-clock seconds for the whole fan-out (parallel, so this is
    # max(child_durations), not sum).
    duration_s: float
    # How many children completed successfully.
    success_count: int


def fan_out(
    subtasks: list[SubTask],
    kairo_cfg: KairoConfig,
    *,
    workspace: Path,
    system_prompt: str = "",
    max_workers: int = 4,
) -> FanOutResult:
    """Run N independent subtasks in parallel.

    Each subtask gets its own Agent instance running in a worker
    thread. Provider calls are blocking inside each thread, so the
    effective parallelism is ``min(max_workers, len(subtasks))``.

    Failures in any child do not abort the others — the parent gets
    back a :class:`FanOutResult` with the success/failure breakdown.
    """
    if not subtasks:
        return FanOutResult(results=[], duration_s=0.0, success_count=0)
    start = time.time()
    results: list[SubTaskResult] = []
    with cf.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_run_subtask, st, kairo_cfg, workspace, system_prompt): st
            for st in subtasks
        }
        for fut in cf.as_completed(futures):
            st = futures[fut]
            try:
                results.append(fut.result())
            except Exception as exc:  # noqa: BLE001
                log.exception("subtask %r crashed", st.id)
                # Synthesize a failure result so the parent sees it.
                fake = AgentResult(
                    messages=[],
                    turns=[],
                    finish_reason="error",
                    error=str(exc),
                )
                results.append(SubTaskResult(subtask=st, agent_result=fake, final_text=""))
    # Sort by original subtask order.
    order = {st.id: i for i, st in enumerate(subtasks)}
    results.sort(key=lambda r: order.get(r.subtask.id, 1_000_000))
    success = sum(1 for r in results if r.agent_result.finish_reason == "complete")
    return FanOutResult(
        results=results,
        duration_s=time.time() - start,
        success_count=success,
    )


# ---------------------------------------------------------------------------
# Pipeline (sequential, each child's output feeds the next)
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class PipelineResult:
    results: list[SubTaskResult]
    final_text: str
    duration_s: float
    success: bool


def pipeline(
    subtasks: list[SubTask],
    kairo_cfg: KairoConfig,
    *,
    workspace: Path,
    system_prompt: str = "",
    # Function that combines the previous child's output into the next
    # child's prompt. Defaults to appending the previous output.
    chained_prompt_fn: Callable[[SubTask, str], str] | None = None,
) -> PipelineResult:
    """Run subtasks in sequence, chaining outputs.

    ``chained_prompt_fn(subtask, prev_output)`` returns the prompt to
    send to this child. The default appends the previous output to the
    subtask's prompt under a ``Context from previous step:`` heading.
    """
    if not subtasks:
        return PipelineResult(results=[], final_text="", duration_s=0.0, success=True)
    start = time.time()
    results: list[SubTaskResult] = []
    prev_output = ""
    success = True
    for st in subtasks:
        if chained_prompt_fn is not None:
            prompt = chained_prompt_fn(st, prev_output)
        else:
            prompt = st.prompt
            if prev_output:
                prompt += f"\n\nContext from previous step:\n{prev_output}"
        # Mutate the subtask's prompt for this run (don't modify the
        # original — make a copy).
        runtime_st = SubTask(
            id=st.id,
            prompt=prompt,
            workspace=st.workspace,
            system_prompt=st.system_prompt,
            max_turns=st.max_turns,
            meta=st.meta,
        )
        r = _run_subtask(runtime_st, kairo_cfg, workspace, system_prompt)
        results.append(r)
        prev_output = r.final_text
        if r.agent_result.finish_reason != "complete":
            success = False
            break
    return PipelineResult(
        results=results,
        final_text=prev_output,
        duration_s=time.time() - start,
        success=success,
    )


# ---------------------------------------------------------------------------
# Helpers for building subtasks from a planner's TODO list
# ---------------------------------------------------------------------------

def subtasks_from_text(
    text: str,
    *,
    workspace: Path | None = None,
    system_prompt: str | None = None,
    max_turns: int | None = None,
) -> list[SubTask]:
    """Parse a TODO-style text blob into SubTask objects.

    Accepts either ``- [ ] item`` markdown or numbered ``1. item`` lists.
    Each item becomes a SubTask with id ``subtask_N``.
    """
    import re
    lines = text.strip().splitlines()
    out: list[SubTask] = []
    idx = 0
    for line in lines:
        s = line.strip()
        if not s:
            continue
        # Strip markdown bullet / checkbox.
        m = re.match(r"^(?:-|\d+\.|\*)\s*(?:\[[ xX]\]\s*)?(.+)$", s)
        if m:
            s = m.group(1).strip()
        else:
            # Skip lines that don't look like list items.
            continue
        idx += 1
        out.append(SubTask(
            id=f"subtask_{idx}",
            prompt=s,
            workspace=workspace,
            system_prompt=system_prompt,
            max_turns=max_turns,
        ))
    return out


def summarize_fan_out(result: FanOutResult) -> str:
    """Build a human-readable summary of a fan-out run for the parent."""
    lines = [f"Fan-out completed: {result.success_count}/{len(result.results)} succeeded "
             f"in {result.duration_s:.1f}s"]
    for r in result.results:
        tag = "OK" if r.agent_result.finish_reason == "complete" else "ERR"
        lines.append(f"  [{tag}] {r.subtask.id}: {r.subtask.prompt[:80]}")
        if r.final_text:
            lines.append(f"      -> {r.final_text[:200]}")
        elif r.agent_result.error:
            lines.append(f"      !! {r.agent_result.error[:200]}")
    return "\n".join(lines)
