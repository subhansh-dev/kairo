"""Tree of Thoughts (ToT) — explore branching reasoning paths.

The ToT pattern (Yao et al. 2023): instead of linear chain-of-thought,
the model explores multiple candidate "thoughts" at each step, evaluates
them, and searches through the thought tree (BFS or DFS) to find the
best solution.

This module provides:
  * :func:`tree_of_thoughts` — runs ToT on a problem with N branches
    per step and depth D.
  * :func:`self_refine` — runs the Self-Refine pattern (iteratively
    critique + improve a single output).

Both are expensive (multiple model calls per step) but solve problems
that single-pass generation can't.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

from kairo.config import KairoConfig
from kairo.types import Message, Role
from kairo.utils import get_logger

log = get_logger("agent.tot")


# ---------------------------------------------------------------------------
# Tree of Thoughts
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class Thought:
    """A single thought node in the tree."""

    text: str
    score: float = 0.0
    parent: "Thought | None" = None
    children: list["Thought"] = field(default_factory=list)
    depth: int = 0


@dataclass(slots=True)
class ToTResult:
    """Outcome of a ToT run."""

    best_path: list[Thought]
    best_score: float
    all_thoughts: list[Thought]
    duration_s: float
    iterations: int


def tree_of_thoughts(
    problem: str,
    kairo_cfg: KairoConfig,
    *,
    breadth: int = 3,
    depth: int = 3,
    evaluator: Callable[[str, str], float] | None = None,
) -> ToTResult:
    """Run Tree of Thoughts on ``problem``.

    Args:
        problem: The problem statement.
        kairo_cfg: Kairo config (used to build a provider).
        breadth: How many candidate thoughts to expand at each step.
        depth: Maximum tree depth.
        evaluator: Optional callable ``(problem, thought) -> float`` in
            [0, 1]. Defaults to a length+keyword heuristic.

    Returns:
        :class:`ToTResult` with the best-scoring path.
    """
    start = time.time()
    from kairo.providers import build_all_enabled
    providers = build_all_enabled(kairo_cfg)
    if not providers:
        raise RuntimeError("no providers available")
    provider = next(iter(providers.values()))
    model = next(iter(kairo_cfg.providers.values())).default_model or "gpt-4o-mini"

    if evaluator is None:
        evaluator = _default_evaluator

    # Root: generate ``breadth`` initial thoughts.
    root_thoughts = _generate_thoughts(
        provider, model, problem, "", n=breadth,
    )
    for t in root_thoughts:
        t.score = evaluator(problem, t.text)

    all_thoughts: list[Thought] = list(root_thoughts)
    frontier: list[Thought] = list(root_thoughts)
    iterations = 0

    for d in range(1, depth):
        # Sort frontier by score, keep top ``breadth``.
        frontier.sort(key=lambda t: -t.score)
        next_frontier: list[Thought] = []
        for parent in frontier[:breadth]:
            iterations += 1
            children = _generate_thoughts(
                provider, model, problem, parent.text, n=2,
            )
            for c in children:
                c.parent = parent
                c.depth = d
                c.score = evaluator(problem, c.text)
                parent.children.append(c)
                all_thoughts.append(c)
                next_frontier.append(c)
        if not next_frontier:
            break
        frontier = next_frontier

    # Find best path: highest-scoring leaf, walk back to root.
    all_thoughts.sort(key=lambda t: -t.score)
    best = all_thoughts[0] if all_thoughts else Thought(text="", score=0.0)
    path: list[Thought] = []
    cur: Thought | None = best
    while cur is not None:
        path.append(cur)
        cur = cur.parent
    path.reverse()

    return ToTResult(
        best_path=path,
        best_score=best.score,
        all_thoughts=all_thoughts,
        duration_s=time.time() - start,
        iterations=iterations,
    )


def _generate_thoughts(provider, model: str, problem: str, prior: str, n: int) -> list[Thought]:
    """Generate ``n`` candidate thoughts for the next step."""
    prompt = (
        f"Problem: {problem}\n\n"
        + (f"Prior reasoning so far:\n{prior}\n\n" if prior else "")
        + f"Generate {n} distinct candidate next thoughts (each a single short paragraph). "
        f"Format as a JSON array of strings. No other text."
    )
    try:
        resp = provider.complete(
            messages=[
                Message(role=Role.SYSTEM, content="You are a Tree of Thoughts reasoning engine."),
                Message(role=Role.USER, content=prompt),
            ],
            tools=None,
            model=model,
        )
        from kairo.agent.structured import parse_json_lenient
        texts = parse_json_lenient(resp.content)
        if isinstance(texts, list):
            return [Thought(text=str(t)) for t in texts[:n]]
    except Exception as exc:  # noqa: BLE001
        log.warning("thought generation failed: %s", exc)
    return []


def _default_evaluator(problem: str, thought: str) -> float:
    """Heuristic thought evaluator.

    Combines:
      * Length (longer = more reasoning, up to a cap)
      * Problem-keyword overlap
    """
    if not thought:
        return 0.0
    length_score = min(0.5, len(thought) / 1000)
    # Word overlap with problem.
    problem_words = set(problem.lower().split())
    thought_words = set(thought.lower().split())
    if not problem_words:
        overlap = 0.0
    else:
        overlap = len(problem_words & thought_words) / len(problem_words) * 0.5
    return length_score + overlap


# ---------------------------------------------------------------------------
# Self-Refine
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class SelfRefineResult:
    """Outcome of a Self-Refine run."""

    final_output: str
    iterations: list[tuple[str, str]]  # (feedback, refined) per iteration
    duration_s: float
    iterations_used: int


def self_refine(
    prompt: str,
    kairo_cfg: KairoConfig,
    *,
    max_iterations: int = 3,
    stop_if_no_feedback: bool = True,
) -> SelfRefineResult:
    """Run Self-Refine (Madaan et al. 2023).

    1. Generate an initial output.
    2. Critique it for weaknesses.
    3. Refine based on the critique.
    4. Repeat until the critic says "no improvements needed" or hit cap.
    """
    start = time.time()
    from kairo.providers import build_all_enabled
    providers = build_all_enabled(kairo_cfg)
    if not providers:
        raise RuntimeError("no providers available")
    provider = next(iter(providers.values()))
    model = next(iter(kairo_cfg.providers.values())).default_model or "gpt-4o-mini"

    # 1. Initial generation.
    resp = provider.complete(
        messages=[Message(role=Role.USER, content=prompt)],
        tools=None,
        model=model,
    )
    current = resp.content.strip()
    iterations: list[tuple[str, str]] = []

    for i in range(max_iterations):
        # 2. Critique.
        critique_resp = provider.complete(
            messages=[
                Message(role=Role.SYSTEM, content=(
                    "You are a critic. Identify specific weaknesses in the "
                    "following output. If there are no significant weaknesses, "
                    "respond with exactly: NO_FEEDBACK"
                )),
                Message(role=Role.USER, content=(
                    f"Original request: {prompt}\n\nOutput to critique:\n{current}"
                )),
            ],
            tools=None,
            model=model,
        )
        feedback = critique_resp.content.strip()
        if stop_if_no_feedback and "NO_FEEDBACK" in feedback.upper():
            break

        # 3. Refine.
        refine_resp = provider.complete(
            messages=[
                Message(role=Role.SYSTEM, content=(
                    "Improve the output based on the critique. Preserve what's "
                    "working; only address the weaknesses identified."
                )),
                Message(role=Role.USER, content=(
                    f"Original request: {prompt}\n\n"
                    f"Current output:\n{current}\n\n"
                    f"Critique:\n{feedback}\n\n"
                    f"Produce the improved output."
                )),
            ],
            tools=None,
            model=model,
        )
        current = refine_resp.content.strip()
        iterations.append((feedback, current))

    return SelfRefineResult(
        final_output=current,
        iterations=iterations,
        duration_s=time.time() - start,
        iterations_used=len(iterations),
    )
