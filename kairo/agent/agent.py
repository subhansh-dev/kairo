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
from kairo.tracing import span

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
    # Optional path to a soul.md persona file. When set, the persona
    # body replaces ``system_prompt``.
    persona_path: Path | None = None
    # When True, the agent queries the learning graph for a hint from
    # past successful runs and injects it into the system prompt.
    use_learning_hint: bool = True


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
        # Register introspection tools backed by a closure over self.
        from kairo.tools.introspection import register_introspection_tools
        register_introspection_tools(self.registry, self._introspection_state)
        self.dispatcher = ToolDispatcher(self.registry, self.guard)
        self.catalog = default_catalog()
        self.orchestrator = Orchestrator(kairo_cfg, self.catalog)
        self.context_mgr = ContextManager(kairo_cfg.context)
        self.safety = SafetyFilter(kairo_cfg.safety)
        # Moderation filters (input + output).
        if kairo_cfg.safety.enable_moderation:
            from kairo.agent.moderation import InputFilter, OutputFilter
            self.input_filter: InputFilter | None = InputFilter()
            self.output_filter: OutputFilter | None = OutputFilter()
        else:
            self.input_filter = None
            self.output_filter = None
        # Budget enforcer (optional, opt-in via config).
        if kairo_cfg.safety.enable_budget_enforcement:
            from kairo.agent.budget_enforcer import get_global_enforcer
            self._budget_enforcer = get_global_enforcer()
            # Per-run scope so each run gets its own limit pool if configured.
            import uuid
            self._budget_scope = f"run:{uuid.uuid4().hex[:12]}"
        else:
            self._budget_enforcer = None
            self._budget_scope = None
        # Provider pool — built once, reused across turns.
        self._providers: dict[str, Provider] = build_all_enabled(kairo_cfg)
        if not self._providers:
            raise KairoError("no providers are enabled; check KairoConfig.providers")
        # Persona — load from soul.md if configured.
        self.persona = None
        if agent_cfg.persona_path is not None:
            from kairo.agent.persona import load_persona
            self.persona = load_persona(agent_cfg.persona_path)
        # Learning graph — loads from workdir if it exists.
        from kairo.agent.learning import LearningGraph
        self.learning = LearningGraph.load(kairo_cfg.workdir)
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
        self._user_message: str = ""  # saved for learning-graph record

    # -- public API ----------------------------------------------------

    def run(self, user_message: str) -> AgentResult:
        """Run the agent loop with a single user message."""
        with span("agent.run", user_message=user_message[:200],
                  workspace=str(self.acfg.workspace)) as root_span:
            return self._run_inner(user_message, root_span)

    def _run_inner(self, user_message: str, root_span) -> AgentResult:
        self._start_ts = time.time()
        self._user_message = user_message
        emit(EventKind.AGENT_START, workspace=str(self.acfg.workspace))

        # Apply input moderation if enabled.
        if self.input_filter is not None:
            mod_result = self.input_filter.check(user_message)
            if mod_result.action.value == "block":
                # Refuse the input entirely.
                self.messages.append(Message(role=Role.USER, content=user_message))
                self.messages.append(Message(
                    role=Role.ASSISTANT,
                    content=mod_result.text,
                    meta={"moderated": True, "rules": mod_result.rules_triggered},
                ))
                return AgentResult(
                    messages=self.messages, turns=[],
                    finish_reason="moderation_block",
                    total_tokens=0, total_cost_usd=0.0,
                    total_duration_s=0.0,
                    error=f"input blocked by moderation: {mod_result.reason}",
                )
            user_message = mod_result.text  # may be redacted

        # Build the system prompt: persona > explicit > default.
        sys_prompt = self.acfg.system_prompt
        if self.persona is not None:
            sys_prompt = self.persona.system_prompt()
        # Append a learning hint if available.
        if self.acfg.use_learning_hint:
            try:
                hint = self.learning.hint_for(user_message)
                if hint:
                    sys_prompt = (sys_prompt + "\n\n" + hint) if sys_prompt else hint
            except Exception as exc:  # noqa: BLE001
                log.warning("learning hint failed: %s", exc)

        # Seed messages: system prompt + user.
        if sys_prompt:
            self.messages.append(Message(role=Role.SYSTEM, content=sys_prompt))
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
        # Record success in the learning graph for future hints.
        if finish_reason == "complete" and self.acfg.use_learning_hint:
            try:
                last_text = ""
                for m in reversed(self.messages):
                    if m.role == Role.ASSISTANT and m.content:
                        last_text = m.content
                        break
                # Collect tools used across all turns.
                tools_used: list[str] = []
                for turn in self.turns:
                    for tr in turn.tool_results:
                        if tr.ok:
                            tools_used.append(tr.name)
                # Identify the model + provider from the last turn.
                last_turn = self.turns[-1] if self.turns else None
                if last_turn and last_turn.provider and last_turn.model:
                    self.learning.record_success(
                        prompt=self._user_message,
                        system_prompt=self.acfg.system_prompt,
                        model=last_turn.model,
                        provider=last_turn.provider,
                        tools_used=tools_used,
                        tool_call_count=len(tools_used),
                        final_text=last_text,
                        duration_s=total_dur,
                        tokens=self._total_tokens,
                    )
            except Exception as exc:  # noqa: BLE001
                log.warning("could not record learning entry: %s", exc)
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

    def _introspection_state(self) -> dict:
        """Snapshot of agent state for the introspection tools."""
        tools_available = [
            {"name": s.name, "description": s.description}
            for s in self.registry.specs()
        ]
        return {
            "turns_used": len(self.turns),
            "max_turns": self.budget.max_turns or self.kcfg.safety.max_turns,
            "tokens_used": self._total_tokens,
            "max_tokens": self.budget.max_tokens,
            "cost_usd": self._total_cost,
            "max_cost_usd": self.budget.max_cost_usd,
            "tools_available": tools_available,
            "message_count": len(self.messages),
            "messages": [m.to_dict() for m in self.messages],
            "phase": self.turns[-1].provider if self.turns else None,
            "model": self.turns[-1].model if self.turns else None,
            "provider": self.turns[-1].provider if self.turns else None,
        }

    # -- per-turn internals --------------------------------------------

    def _run_turn(self, turn_idx: int) -> AgentTurn:
        with span("agent.turn", turn_idx=turn_idx) as turn_span:
            return self._run_turn_inner(turn_idx, turn_span)

    def _run_turn_inner(self, turn_idx: int, turn_span) -> AgentTurn:
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
        # Budget enforcement: check before the call.
        if self._budget_enforcer is not None and self._budget_scope is not None:
            from kairo.errors import BudgetExceeded
            try:
                self._budget_enforcer.check_and_reserve(
                    self._budget_scope,
                    est_turns=1,
                    # We don't know cost/tokens ahead of time, so only
                    # check turns here. Usage is recorded after the call.
                )
            except BudgetExceeded as exc:
                raise BudgetExceeded(
                    f"budget exhausted before turn {turn_idx}: {exc}"
                ) from exc
        try:
            with span("provider.complete",
                      provider=model.provider, model=model.name,
                      phase=plan.phase, est_tokens=ctx_tokens):
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

        # 5.5. Record usage with the budget enforcer.
        if self._budget_enforcer is not None and self._budget_scope is not None:
            usage = response.usage or {}
            self._budget_enforcer.record_usage(
                self._budget_scope,
                cost_usd=_estimate_cost(response, model),
                tokens=usage.get("total_tokens", 0),
                turns=1,
            )

        # 6. Track usage / cost.
        if response.usage:
            self._total_tokens += response.usage.get("total_tokens", 0)
        self._total_cost += _estimate_cost(response, model)

        # 7. Append assistant message.
        # Apply output moderation first — redact secrets/PII from the response.
        if self.output_filter is not None and response.content:
            mod_result = self.output_filter.check(response.content)
            if mod_result.action.value == "block":
                response.content = mod_result.text
                response.tool_calls = []  # don't act on blocked output
            elif mod_result.action.value == "redact":
                response.content = mod_result.text
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

        # 7.5. Fallback: if the provider didn't parse any tool calls but the
        # response text contains tool-call-shaped blocks, run the grammar
        # extractor. This catches tiny-model output the provider missed.
        if not response.tool_calls and response.content and tools:
            try:
                from kairo.agent.tool_grammar import extract_tool_calls_grammar
                grammar_result = extract_tool_calls_grammar(response.content, self.registry)
                if grammar_result.calls:
                    response.tool_calls = grammar_result.calls
                    assistant_msg.tool_calls = grammar_result.calls
                    log.info("tool_grammar fallback extracted %d calls from response text",
                             len(grammar_result.calls))
            except Exception as exc:  # noqa: BLE001
                log.warning("tool_grammar fallback failed: %s", exc)

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
                with span("tool.dispatch", call_count=len(allowed_calls),
                          tool_names=[c.name for c in allowed_calls]):
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
