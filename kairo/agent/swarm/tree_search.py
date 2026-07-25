"""Tree-search agent — explore multiple approaches in parallel, pick best.

For tasks with no single obvious solution (e.g. "fix this bug" — could
be 5 different root causes), tree-search spawns N child agents that
each try a different approach, evaluates their outputs, and returns
the best one. Inspired by AlphaCode's cluster-and-select.

Evaluation strategies:
  * ``first_success`` — return the first child that completes successfully.
  * ``vote`` — each child's output is voted on by a critic model; the
    output with the most votes wins. Slower but more reliable.
  * ``self_consistency`` — group children by their final-text hash;
    return the most common output (assumes majority is correct).
  * ``critic`` — a single critic model scores each output 0-10;
    return the highest.

This is expensive (N x the cost of a single agent run) but it catches
the "one weak model went off the rails" failure mode that single-agent
runs suffer from.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Literal

from kairo.agent import Agent, AgentConfig
from kairo.agent.swarm import FanOutResult, SubTask, SubTaskResult, _run_subtask, fan_out
from kairo.config import KairoConfig
from kairo.types import AgentResult, Message, Role
from kairo.utils import get_logger

log = get_logger("agent.swarm.tree_search")


SelectionStrategy = Literal["first_success", "vote", "self_consistency", "critic"]


@dataclass(slots=True)
class TreeSearchResult:
    """Outcome of a tree-search run."""

    chosen: SubTaskResult
    all_results: list[SubTaskResult]
    strategy: SelectionStrategy
    # Why this result was chosen.
    reason: str
    # Strategy-specific metadata (vote counts, critic scores, etc.).
    meta: dict


def tree_search(
    subtasks: list[SubTask],
    kairo_cfg: KairoConfig,
    *,
    workspace,
    system_prompt: str = "",
    strategy: SelectionStrategy = "first_success",
    max_workers: int = 4,
    # Optional critic callable: (subtask, output) -> score in [0, 1].
    # Required when strategy == "critic".
    critic: Callable[[SubTask, str], float] | None = None,
) -> TreeSearchResult:
    """Run N children in parallel and pick the best output."""
    if not subtasks:
        raise ValueError("tree_search requires at least one subtask")
    fan = fan_out(
        subtasks,
        kairo_cfg,
        workspace=workspace,
        system_prompt=system_prompt,
        max_workers=max_workers,
    )

    chosen: SubTaskResult | None = None
    reason = ""
    meta: dict = {}

    if strategy == "first_success":
        for r in fan.results:
            if r.agent_result.finish_reason == "complete":
                chosen = r
                reason = "first child to complete successfully"
                break
        if chosen is None:
            # No successes — fall back to the first result.
            chosen = fan.results[0]
            reason = "no child succeeded; returning first result"

    elif strategy == "self_consistency":
        # Group by hash of final_text.
        groups: dict[str, list[SubTaskResult]] = {}
        for r in fan.results:
            if not r.final_text:
                continue
            h = hashlib.sha256(r.final_text.strip().encode()).hexdigest()[:16]
            groups.setdefault(h, []).append(r)
        if not groups:
            chosen = fan.results[0]
            reason = "no outputs to compare; returning first"
        else:
            # Pick the largest group; within it, pick the first.
            best_hash = max(groups, key=lambda h: len(groups[h]))
            chosen = groups[best_hash][0]
            reason = (f"self-consistency: {len(groups[best_hash])} of "
                      f"{len(fan.results)} children produced this output")
            meta["group_sizes"] = {h: len(g) for h, g in groups.items()}

    elif strategy == "vote":
        # Run N critic models, each voting for one output. We approximate
        # this by hashing outputs and picking the most-common bucket,
        # since real voting requires extra model calls. For real voting,
        # use the "critic" strategy.
        log.warning("vote strategy falls back to self_consistency; use 'critic' for real voting")
        return tree_search(
            subtasks, kairo_cfg, workspace=workspace, system_prompt=system_prompt,
            strategy="self_consistency", max_workers=max_workers, critic=critic,
        )

    elif strategy == "critic":
        if critic is None:
            raise ValueError("critic strategy requires a critic callable")
        scored = []
        for r in fan.results:
            if r.agent_result.finish_reason != "complete":
                continue
            try:
                score = critic(r.subtask, r.final_text)
            except Exception as exc:  # noqa: BLE001
                log.warning("critic crashed on %s: %s", r.subtask.id, exc)
                score = 0.0
            scored.append((score, r))
        if not scored:
            chosen = fan.results[0]
            reason = "no scored outputs; returning first"
        else:
            scored.sort(key=lambda x: -x[0])
            chosen = scored[0][1]
            reason = f"critic picked this output with score {scored[0][0]:.2f}"
            meta["scores"] = {r.subtask.id: s for s, r in scored}

    else:
        raise ValueError(f"unknown selection strategy: {strategy!r}")

    return TreeSearchResult(
        chosen=chosen,
        all_results=fan.results,
        strategy=strategy,
        reason=reason,
        meta=meta,
    )


def default_critic_factory(agent_factory: Callable[[], Agent]) -> Callable[[SubTask, str], float]:
    """Build a critic callable that uses a Kairo Agent to score outputs.

    The critic agent is given the subtask prompt + the candidate output
    and asked to reply with a single float score in [0, 1]. Replies that
    don't parse fall back to 0.5.
    """
    def _critic(subtask: SubTask, output: str) -> float:
        agent = agent_factory()
        prompt = (
            f"You are a critic. Score the following agent output on a scale of "
            f"0.0 to 1.0 based on whether it correctly addresses the task.\n\n"
            f"TASK: {subtask.prompt}\n\n"
            f"OUTPUT:\n{output[:2000]}\n\n"
            f"Reply with ONLY a single float in [0.0, 1.0]."
        )
        result = agent.run(prompt)
        last = ""
        for m in reversed(result.messages):
            if m.role == Role.ASSISTANT and m.content:
                last = m.content.strip()
                break
        try:
            score = float(last.splitlines()[0].strip())
            return max(0.0, min(1.0, score))
        except (ValueError, IndexError):
            return 0.5
    return _critic
