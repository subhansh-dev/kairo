"""Multi-model orchestrator — planner / executor / critic pattern.

When :attr:`OrchestratorConfig.enabled` is True, the agent loop uses the
orchestrator instead of a flat single-model loop:

  1. **Planner** model produces a TODO list (via the ``todo_set`` tool).
  2. **Executor** model works through the TODOs one at a time, calling
     tools as needed.
  3. **Critic** model verifies each executor step and may flag issues,
     which send the executor back to retry or the planner back to
     replan (up to ``max_replans`` times).

When disabled, the orchestrator is a no-op and the agent loop falls
through to a single-model path.

The orchestrator does NOT call providers directly — it returns a
:class:`PhasePlan` that the agent loop executes. This keeps the
orchestrator testable without real LLM calls.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from kairo.config import KairoConfig
from kairo.routing.catalog import ModelCatalog
from kairo.routing.router import Router, RouterContext
from kairo.types import Message, RoutingDecision, TaskKind
from kairo.utils import get_logger

log = get_logger("routing.orchestrator")


Phase = Literal["planner", "executor", "critic"]


@dataclass(slots=True)
class PhasePlan:
    """What the orchestrator wants the agent loop to do next."""

    phase: Phase
    decision: RoutingDecision
    # When set, the agent loop should inject this as a system message
    # before the next provider call.
    system_hint: str | None = None
    # When set, the agent loop should pass this TaskKind hint to the
    # router for the next pick (used to break ties).
    next_kind_hint: TaskKind | None = None


@dataclass(slots=True)
class OrchestratorState:
    """Mutable state tracked across one agent run."""

    enabled: bool = False
    current_phase: Phase = "planner"
    replans_remaining: int = 2
    # How many executor turns we've run in the current TODO item.
    executor_turns_in_item: int = 0
    # How many critic rejections we've seen in a row.
    critic_streak: int = 0
    # The TODO ids the planner emitted, in order.
    planned_items: list[str] = field(default_factory=list)
    # The TODO id currently being worked on.
    current_item_id: str | None = None
    # When True the next planner call should produce a fresh plan.
    needs_replan: bool = False


class Orchestrator:
    """Lightweight multi-phase coordinator.

    The orchestrator is *stateful* per agent run — construct a fresh one
    for each :class:`Agent` invocation.
    """

    def __init__(self, cfg: KairoConfig, catalog: ModelCatalog) -> None:
        self.cfg = cfg
        self.ocfg = cfg.orchestrator
        self.router = Router(catalog, cfg)
        self.state = OrchestratorState(
            enabled=self.ocfg.enabled,
            replans_remaining=self.ocfg.max_replans,
        )

    # -- lifecycle -----------------------------------------------------

    def begin(self, messages: list[Message]) -> PhasePlan:
        """Return the first phase plan for a new agent run."""
        if not self.state.enabled:
            # Fall back to a single-model pick so the agent loop works.
            ctx = RouterContext(messages=messages, needs_tools=True)
            return PhasePlan(
                phase="executor",
                decision=self.router.pick(ctx),
                system_hint=None,
            )
        self.state.current_phase = "planner"
        ctx = RouterContext(messages=messages, needs_tools=False, phase="planner")
        decision = self.router.pick_phase("planner", ctx)
        return PhasePlan(
            phase="planner",
            decision=decision,
            system_hint=(
                "You are the PLANNER. Decompose the user's request into a small "
                "ordered TODO list (3-8 items) and emit it via the `todo_set` tool. "
                "Do not write code. Each TODO must be concrete enough that an "
                "executor model can pick it up without further clarification."
            ),
            next_kind_hint=TaskKind.PLAN,
        )

    # -- per-turn advancement ------------------------------------------

    def advance(
        self,
        messages: list[Message],
        last_response_had_tool_calls: bool,
        last_response_content: str,
        critic_feedback: str | None = None,
    ) -> PhasePlan:
        """Decide what to do next based on what just happened.

        Args:
            messages: Full conversation so far.
            last_response_had_tool_calls: Did the previous provider
                response include tool calls?
            last_response_content: Text content of the previous response.
            critic_feedback: If the previous phase was critic, any
                issues raised (otherwise None).
        """
        if not self.state.enabled:
            # Single-model mode — keep using the executor.
            ctx = RouterContext(messages=messages, needs_tools=True)
            return PhasePlan(
                phase="executor",
                decision=self.router.pick(ctx),
            )

        phase = self.state.current_phase

        if phase == "planner":
            # Planner should have just called todo_set. Move to executor.
            self.state.current_phase = "executor"
            self.state.executor_turns_in_item = 0
            ctx = RouterContext(messages=messages, needs_tools=True, phase="executor")
            decision = self.router.pick_phase("executor", ctx)
            return PhasePlan(
                phase="executor",
                decision=decision,
                system_hint=(
                    "You are the EXECUTOR. Work through the TODO list one item at "
                    "a time. Before starting each item, call `todo_update` to mark "
                    "it in_progress. After finishing, mark it completed. Do not "
                    "skip items or work on multiple at once."
                ),
                next_kind_hint=TaskKind.CODE,
            )

        if phase == "executor":
            self.state.executor_turns_in_item += 1
            # If executor did tool calls, keep going on the same model.
            if last_response_had_tool_calls:
                ctx = RouterContext(messages=messages, needs_tools=True, phase="executor")
                return PhasePlan(
                    phase="executor",
                    decision=self.router.pick_phase("executor", ctx),
                )
            # No tool calls = executor thinks the item is done. Run critic
            # unless we're skipping critic-on-every-turn.
            if self.ocfg.critic_on_every_turn or self.state.executor_turns_in_item > 1:
                self.state.current_phase = "critic"
                ctx = RouterContext(messages=messages, needs_tools=False, phase="critic")
                decision = self.router.pick_phase("critic", ctx)
                return PhasePlan(
                    phase="critic",
                    decision=decision,
                    system_hint=(
                        "You are the CRITIC. Review the executor's last step. "
                        "If it is correct and complete, say APPROVE. If not, "
                        "describe the issue concisely and the executor will retry. "
                        "Do not write code yourself."
                    ),
                    next_kind_hint=TaskKind.CODE_REVIEW,
                )
            # Otherwise, executor says done and we trust it; continue executor.
            ctx = RouterContext(messages=messages, needs_tools=True, phase="executor")
            return PhasePlan(
                phase="executor",
                decision=self.router.pick_phase("executor", ctx),
            )

        if phase == "critic":
            if critic_feedback and "APPROVE" not in last_response_content.upper():
                self.state.critic_streak += 1
                if self.state.critic_streak >= 3:
                    # Too many rejections — escalate to replan.
                    if self.state.replans_remaining > 0:
                        self.state.replans_remaining -= 1
                        self.state.critic_streak = 0
                        self.state.current_phase = "planner"
                        self.state.needs_replan = True
                        ctx = RouterContext(messages=messages, needs_tools=False, phase="planner")
                        decision = self.router.pick_phase("planner", ctx)
                        return PhasePlan(
                            phase="planner",
                            decision=decision,
                            system_hint=(
                                "You are the PLANNER (replanning). The previous plan "
                                "failed at the executor step after repeated critic "
                                f"rejections: {critic_feedback}. Produce a revised "
                                "TODO list that avoids the failure."
                            ),
                            next_kind_hint=TaskKind.PLAN,
                        )
                # Back to executor with feedback.
                self.state.current_phase = "executor"
                self.state.executor_turns_in_item = 0
                ctx = RouterContext(messages=messages, needs_tools=True, phase="executor")
                decision = self.router.pick_phase("executor", ctx)
                return PhasePlan(
                    phase="executor",
                    decision=decision,
                    system_hint=(
                        "You are the EXECUTOR (retrying). The critic rejected your "
                        f"last attempt: {critic_feedback}. Address the feedback and "
                        "try again."
                    ),
                    next_kind_hint=TaskKind.CODE,
                )
            # Approved — keep executing the next item.
            self.state.critic_streak = 0
            self.state.current_phase = "executor"
            self.state.executor_turns_in_item = 0
            ctx = RouterContext(messages=messages, needs_tools=True, phase="executor")
            decision = self.router.pick_phase("executor", ctx)
            return PhasePlan(
                phase="executor",
                decision=decision,
                system_hint="You are the EXECUTOR. Pick up the next TODO item.",
                next_kind_hint=TaskKind.CODE,
            )

        # Fallback (shouldn't happen).
        ctx = RouterContext(messages=messages, needs_tools=True)
        return PhasePlan(phase="executor", decision=self.router.pick(ctx))
