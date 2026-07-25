"""Reflexion — let the agent reflect on failures and retry.

Reflexion is a simple but powerful technique: when the agent fails a
task, instead of giving up, it writes a short verbal reflection on
*why* it failed, then retries with that reflection as additional
context. After a few rounds, the agent usually converges on a working
solution.

Paper: Shinn et al. "Reflexion: Language Agents with Verbal
Reinforcement Learning" (2023).

Kairo's implementation is a thin wrapper around :class:`Agent`:

    from kairo.agent.reflexion import reflexion_run
    result = reflexion_run(agent_cfg, kairo_cfg, "Fix the bug", max_attempts=3)

Each attempt's final assistant message + a critic-style reflection
become the seed for the next attempt. The function returns the
successful :class:`AgentResult` (or the last failed one if all attempts
fail).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig
from kairo.types import AgentResult, Message, Role
from kairo.utils import get_logger

log = get_logger("agent.reflexion")


# A critic takes the task prompt + the agent's last attempt and returns
# either None (success, no reflection needed) or a string reflection
# describing what went wrong and what to try next.
Critic = Callable[[str, AgentResult], str | None]


@dataclass(slots=True)
class ReflexionResult:
    """Outcome of a reflexion run."""

    attempts: list[AgentResult]
    reflections: list[str]
    final: AgentResult
    succeeded: bool
    duration_s: float
    attempts_used: int


def default_critic(task_prompt: str, attempt: AgentResult) -> str | None:
    """Default critic: success = finish_reason==complete + no tool errors.

    When the attempt succeeds, returns None (no reflection needed).
    When it fails, returns a short structured reflection:
    """
    if attempt.finish_reason == "complete":
        # Check for any tool errors.
        for turn in attempt.turns:
            for tr in turn.tool_results:
                if not tr.ok and tr.error and "GUARDRAIL" not in tr.error:
                    return (
                        f"Previous attempt completed but tool {tr.name!r} "
                        f"failed with: {tr.error[:200]}. "
                        f"Fix this tool call or take a different approach."
                    )
        return None
    # Failed.
    return (
        f"Previous attempt failed with finish_reason={attempt.finish_reason} "
        f"and error: {(attempt.error or 'unknown')[:200]}. "
        f"Take a different approach: be more methodical, use list_dir first "
        f"to understand the workspace, and break the task into smaller steps."
    )


def reflexion_run(
    agent_cfg: AgentConfig,
    kairo_cfg: KairoConfig,
    user_message: str,
    *,
    max_attempts: int = 3,
    critic: Critic | None = None,
) -> ReflexionResult:
    """Run the agent with reflexion-style retries.

    Args:
        agent_cfg: Base agent config (workspace, system_prompt, etc.).
        kairo_cfg: Kairo config.
        user_message: The task prompt.
        max_attempts: Maximum number of attempts (including the first).
        critic: Optional custom critic. Defaults to :func:`default_critic`.

    Returns:
        A :class:`ReflexionResult` with all attempts and the final result.
    """
    if max_attempts < 1:
        raise ValueError("max_attempts must be >= 1")
    critic = critic or default_critic
    attempts: list[AgentResult] = []
    reflections: list[str] = []
    start = time.time()
    last: AgentResult | None = None

    for attempt_idx in range(max_attempts):
        # Build the prompt: original task + accumulated reflections.
        prompt = user_message
        if reflections:
            prompt += "\n\n--- Reflections from previous attempts ---\n"
            for i, r in enumerate(reflections, 1):
                prompt += f"\nAttempt {i} reflection: {r}\n"
            prompt += "\n--- End reflections ---\n"
            prompt += "\nUse these reflections to avoid the same mistakes."

        agent = Agent(kairo_cfg, agent_cfg)
        result = agent.run(prompt)
        attempts.append(result)
        last = result

        # Critique the attempt.
        reflection = critic(user_message, result)
        if reflection is None:
            log.info("reflexion: attempt %d succeeded", attempt_idx + 1)
            return ReflexionResult(
                attempts=attempts,
                reflections=reflections,
                final=result,
                succeeded=True,
                duration_s=time.time() - start,
                attempts_used=attempt_idx + 1,
            )
        reflections.append(reflection)
        log.info("reflexion: attempt %d failed, reflecting: %s",
                 attempt_idx + 1, reflection[:100])

    assert last is not None
    return ReflexionResult(
        attempts=attempts,
        reflections=reflections,
        final=last,
        succeeded=False,
        duration_s=time.time() - start,
        attempts_used=max_attempts,
    )


def llm_critic_factory(
    agent_factory: Callable[[], Agent],
) -> Critic:
    """Build a critic that uses an LLM agent to evaluate attempts.

    The critic agent is given the task + the attempt's final text and
    asked to reply either ``SUCCESS`` or with a reflection. More
    expensive than :func:`default_critic` but more accurate.
    """
    def _critic(task_prompt: str, attempt: AgentResult) -> str | None:
        last_text = ""
        for m in reversed(attempt.messages):
            if m.role == Role.ASSISTANT and m.content:
                last_text = m.content
                break
        agent = agent_factory()
        prompt = (
            f"You are a critic. Evaluate whether the following agent "
            f"output successfully completes the task.\n\n"
            f"TASK: {task_prompt}\n\n"
            f"AGENT OUTPUT (finish_reason={attempt.finish_reason}):\n"
            f"{last_text[:2000]}\n\n"
            f"If the output succeeds, reply with exactly: SUCCESS\n"
            f"If not, reply with a single-paragraph reflection on what "
            f"went wrong and what to try next."
        )
        result = agent.run(prompt)
        last = ""
        for m in reversed(result.messages):
            if m.role == Role.ASSISTANT and m.content:
                last = m.content.strip()
                break
        if last.upper().startswith("SUCCESS"):
            return None
        return last
    return _critic
