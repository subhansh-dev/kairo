"""The Kairo agent loop.

This is the orchestration core: it pulls messages + tools, asks the
router which model to use, calls the provider, dispatches any tool
calls through the SpamGuard + dispatcher, feeds results back, and
repeats until the model produces a final answer (no tool calls) or a
budget/limit is hit.

The loop is synchronous. Async tools run on a worker thread via the
dispatcher's internal event loop. This keeps the loop easy to reason
about while still letting tool calls parallelize.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

from kairo.agent.context import ContextManager, estimate_conversation_tokens
from kairo.agent.dispatcher import ToolDispatcher
from kairo.agent.memory import SessionStore, analyze_run
from kairo.agent.safety import SafetyFilter
from kairo.config import KairoConfig
from kairo.errors import BudgetExceeded, KairoError, LoopLimitExceeded
from kairo.providers import build_all_enabled
from kairo.providers.base import Provider
from kairo.routing import Orchestrator, default_catalog
from kairo.routing.router import RouterContext
from kairo.tools import ToolBundleConfig, build_default_registry
from kairo.types import (
    AgentResult,
    AgentTurn,
    Budget,
    Message,
    ProviderResponse,
    Role,
    ToolCall,
    ToolResult,
)
from kairo.utils import EventKind, emit, get_logger, get_event_bus

log = get_logger("agent")


@dataclass(slots=True)
class AgentConfig:
    """Per-run agent configuration."""

    workspace: Path
    system_prompt: str = ""
    # When None, picks "complete" when the model emits no tool calls.
    max_turns: int | None = None
    # Optional per-run budget override (otherwise uses cfg.safety caps).
    budget: Budget | None = None
    # When True, every provider response is logged to the event bus.
    emit_events: bool = True


class Agent:
    """A Kairo agent run.

    Construct one per user request. Reusing across requests is fine if
    you reset state, but a fresh instance is the cleanest pattern.

    Usage::

        agent = Agent(kairo_cfg)
        result = agent.run("Fix the bug in src/foo.py")
        print(result.finish_reason)
    """

    def __init__(self, kairo_cfg: KairoConfig, agent_cfg: AgentConfig) -> None:
        self.kcfg = kairo_cfg
        self.acfg = agent_cfg
        # Build subsystems.
        bundle_cfg = ToolBundleConfig(workspace=agent_cfg.workspace)
        self.registry, self.guard, self.todo_store = build_default_registry(bundle_cfg)
        self.dispatcher = ToolDispatcher(self.registry, self.guard)
        self.catalog = default_catalog()
        self.orchestrator = Orchestrator(kairo_cfg, self.catalog)
        self.context_mgr = ContextManager(kairo_cfg.context)
        self.safety = SafetyFilter(kairo_cfg.safety)
        # Provider pool — built once, reused across turns.
        self._providers: dict[str, Provider] = build_all_enabled(kairo_cfg)
        if not self._providers:
            raise KairoError("no providers are enabled; check KairoConfig.providers")
        # Per-run state.
        self.messages: list[Message] = []
        self.turns: list[AgentTurn] = []
        self.budget: Budget = agent_cfg.budget or Budget(
            max_turns=agent_cfg.max_turns or kairo_cfg.safety.max_turns,
            max_tokens=None,
            max_cost_usd=None,
            max_wall_s=None,
        )
        self._total_tokens = 0
        self._total_cost = 0.0
        self._start_ts = 0.0
        self._cancelled = False

    # -- public API ----------------------------------------------------

    def run(self, user_message: str) -> AgentResult:
        """Run the agent loop with a single user message."""
        self._start_ts = time.time()
        emit(EventKind.AGENT_START, workspace=str(self.acfg.workspace))

        # Seed messages: system prompt + user.
        if self.acfg.system_prompt:
            self.messages.append(Message(role=Role.SYSTEM, content=self.acfg.system_prompt))
        self.messages.append(Message(role=Role.USER, content=user_message))

        max_turns = self.budget.max_turns or self.kcfg.safety.max_turns
        finish_reason = "complete"
        error: str | None = None

        try:
            for turn_idx in range(max_turns):
                if self._cancelled:
                    finish_reason = "cancelled"
                    break
                turn = self._run_turn(turn_idx)
                self.turns.append(turn)
                if not turn.response.is_tool_turn:
                    # Model produced a final answer.
                    finish_reason = "complete"
                    break
            else:
                finish_reason = "loop_limit"
                raise LoopLimitExceeded(f"hit max_turns={max_turns}")
        except BudgetExceeded as exc:
            finish_reason = "budget"
            error = str(exc)
            log.warning("budget exceeded: %s", exc)
        except LoopLimitExceeded as exc:
            finish_reason = "loop_limit"
            error = str(exc)
            log.warning("loop limit: %s", exc)
        except KairoError as exc:
            finish_reason = "error"
            error = str(exc)
            log.exception("agent error")
        finally:
            self.dispatcher.shutdown()

        total_dur = time.time() - self._start_ts
        result = AgentResult(
            messages=self.messages,
            turns=self.turns,
            finish_reason=finish_reason,
            total_tokens=self._total_tokens,
            total_cost_usd=self._total_cost,
            total_duration_s=total_dur,
            error=error,
        )
        # Persist if configured.
        if self.kcfg.persist_turns:
            try:
                store = SessionStore(self.kcfg.workdir)
                store.save(result, tag=finish_reason)
            except Exception as exc:  # noqa: BLE001 — persistence is best-effort
                log.warning("could not persist run: %s", exc)
        emit(
            EventKind.AGENT_END,
            finish_reason=finish_reason,
            turns=len(self.turns),
            tokens=self._total_tokens,
            cost_usd=self._total_cost,
            duration_s=total_dur,
        )
        return AgentResult(
            messages=self.messages,
            turns=self.turns,
            finish_reason=finish_reason,
            total_tokens=self._total_tokens,
            total_cost_usd=self._total_cost,
            total_duration_s=total_dur,
            error=error,
        )

    def cancel(self) -> None:
        """Request cancellation — the loop checks this between turns."""
        self._cancelled = True

    # -- per-turn internals --------------------------------------------

    def _run_turn(self, turn_idx: int) -> AgentTurn:
        started = time.time()
        self.guard.begin_turn()

        # 1. Orchestrator picks a phase + model.
        if turn_idx == 0:
            plan = self.orchestrator.begin(self.messages)
        else:
            last = self.turns[-1]
            plan = self.orchestrator.advance(
                messages=self.messages,
                last_response_had_tool_calls=last.response.is_tool_turn,
                last_response_content=last.response.content,
            )
        model = plan.decision.model
        provider = self._providers.get(model.provider)
        if provider is None:
            raise KairoError(
                f"router picked {model.provider}:{model.name} but provider "
                f"{model.provider!r} is not available"
            )

        # 2. Context compaction if needed.
        ctx_tokens = estimate_conversation_tokens(self.messages, self.kcfg.context)
        compaction = self.context_mgr.maybe_compact(self.messages, model.context)
        if compaction.removed_count > 0:
            self.messages = compaction.messages
            ctx_tokens = compaction.tokens_after

        # 3. Inject system hint from orchestrator.
        request_messages = list(self.messages)
        if plan.system_hint:
            request_messages.insert(
                0,
                Message(role=Role.SYSTEM, content=plan.system_hint, meta={"phase": plan.phase}),
            )

        # 4. Tool list (filtered by phase — planner doesn't need shell, etc.).
        tools = self._tools_for_phase(plan.phase)

        emit(
            EventKind.TURN_START,
            turn=turn_idx,
            phase=plan.phase,
            model=f"{model.provider}:{model.name}",
            reason=plan.decision.reason,
            est_tokens=ctx_tokens,
        )

        # 5. Call provider.
        try:
            response = provider.complete(
                messages=request_messages,
                tools=tools if tools else None,
                model=model.name,
                temperature=0.0,
            )
        except KairoError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise KairoError(f"provider {model.provider} failed: {exc}") from exc

        # 6. Track usage / cost.
        if response.usage:
            self._total_tokens += response.usage.get("total_tokens", 0)
        self._total_cost += _estimate_cost(response, model)

        # 7. Append assistant message.
        assistant_msg = Message(
            role=Role.ASSISTANT,
            content=response.content,
            tool_calls=response.tool_calls,
            meta={
                "provider": model.provider,
                "model": model.name,
                "phase": plan.phase,
                "latency_s": response.latency_s,
            },
        )
        self.messages.append(assistant_msg)

        # 8. Dispatch tool calls.
        tool_results: list[ToolResult] = []
        if response.tool_calls:
            # Dangerous-tool confirmation pass + unknown-tool detection.
            allowed_calls = []
            for call in response.tool_calls:
                if not self.registry.has(call.name):
                    tool_results.append(ToolResult(
                        call_id=call.id, name=call.name, ok=False, content=None,
                        error=f"Tool not registered: {call.name}",
                    ))
                    continue
                spec = self.registry.get(call.name).spec
                err = self.safety.confirm_dangerous(call, spec.tags)
                if err is not None:
                    tool_results.append(ToolResult(
                        call_id=call.id, name=call.name, ok=False, content=None,
                        error=f"GUARDRAIL [{err.rule}]: {err}",
                    ))
                else:
                    allowed_calls.append(call)
            # Dispatch only the allowed subset through the spam guard.
            if allowed_calls:
                dispatch = self.dispatcher.dispatch(allowed_calls)
                tool_results.extend(dispatch.results)
            # Safety filter on all results (incl. blocked/denied).
            for tr in tool_results:
                self.safety.check_tool_output(tr)
            # Always append tool results as messages — even when every
            # call was rejected. The model needs to see the failure to
            # recover on the next turn.
            for tr in tool_results:
                self.budget.record_call(tr.name)
                self.messages.append(Message(role=Role.TOOL, tool_result=tr))

        ended = time.time()
        turn = AgentTurn(
            index=turn_idx,
            request_messages=request_messages,
            response=response,
            tool_results=tool_results,
            started_at=started,
            ended_at=ended,
            model=model.name,
            provider=model.provider,
            router_reason=plan.decision.reason,
        )
        emit(
            EventKind.TURN_END,
            turn=turn_idx,
            phase=plan.phase,
            had_tool_calls=bool(response.tool_calls),
            tool_count=len(response.tool_calls or []),
            tokens=self._total_tokens,
            cost_usd=self._total_cost,
            duration_s=ended - started,
        )
        return turn

    # -- helpers -------------------------------------------------------

    def _tools_for_phase(self, phase: str) -> list:
        """Filter tools by orchestrator phase.

        Planner: only todo tools.
        Executor: everything.
        Critic: read-only tools only.
        """
        specs = self.registry.specs()
        if phase == "planner":
            return [s for s in specs if s.name.startswith("todo_")]
        if phase == "critic":
            # Read-only = no "mutating" or "dangerous" tag.
            return [s for s in specs if not ({"mutating", "dangerous"} & set(s.tags))]
        return specs


def _estimate_cost(resp: ProviderResponse, model) -> float:
    """Estimate cost (USD) of a single provider response."""
    if not resp.usage:
        return 0.0
    in_tokens = resp.usage.get("prompt_tokens", 0)
    out_tokens = resp.usage.get("completion_tokens", 0)
    return (in_tokens * model.cost_in_per_m + out_tokens * model.cost_out_per_m) / 1_000_000
