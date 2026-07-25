"""Streaming agent — wraps :class:`Agent` with live token streaming.

Kairo's :class:`Agent` is non-streaming: it calls provider.complete()
and waits for the full response. This module adds a streaming variant
that:

  * Calls the provider's streaming endpoint.
  * Yields text deltas as they arrive (so the REPL/CLI can print them live).
  * Assembles the final response for the agent loop.

The streaming agent uses the same provider pool, router, orchestrator,
and tool dispatcher as the regular agent. The only difference is the
provider call: instead of ``provider.complete()``, it uses
``stream_openai_compat()`` (or ``stream_anthropic()``) and feeds the
events to ``assemble_stream()``.

Usage::

    from kairo.agent.streaming import StreamingAgent, AgentConfig

    agent = StreamingAgent(kairo_cfg, AgentConfig(workspace=Path(".")))
    for event in agent.run_stream("Fix the bug"):
        if event.kind == "text_delta":
            print(event.data, end="", flush=True)
        elif event.kind == "tool_call_start":
            print(f"\n[calling {event.data}]")
        elif event.kind == "done":
            print(f"\n[done: {event.data}]")

The streaming agent emits the same tracing spans as the regular agent
plus ``stream.delta`` events.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig
from kairo.errors import KairoError
from kairo.providers.streaming import (
    StreamEvent,
    assemble_stream,
    stream_anthropic,
    stream_openai_compat,
)
from kairo.types import (
    AgentResult,
    AgentTurn,
    Message,
    ProviderResponse,
    Role,
    ToolCall,
    ToolResult,
)
from kairo.utils import EventKind, emit, get_logger
from kairo.tracing import span

log = get_logger("agent.streaming")


class StreamingAgent(Agent):
    """Variant of :class:`Agent` that streams tokens live.

    Inherits everything from Agent. The only method overridden is the
    provider-call site inside ``_run_turn_inner``: instead of
    ``provider.complete()``, it calls the streaming function and yields
    events to the caller.
    """

    def run_stream(self, user_message: str) -> Iterator[StreamEvent]:
        """Run the agent, yielding stream events as they happen.

        The caller should iterate over the returned iterator and handle
        each event (text deltas, tool calls, done). The final
        :class:`AgentResult` is available via the ``done`` event's
        ``usage`` field (or just call :meth:`run` after streaming).
        """
        # Seed messages the same way Agent.run does.
        self._start_ts = time.time()
        self._user_message = user_message
        emit(EventKind.AGENT_START, workspace=str(self.acfg.workspace))

        sys_prompt = self.acfg.system_prompt
        if self.persona is not None:
            sys_prompt = self.persona.system_prompt()
        if self.acfg.use_learning_hint:
            try:
                hint = self.learning.hint_for(user_message)
                if hint:
                    sys_prompt = (sys_prompt + "\n\n" + hint) if sys_prompt else hint
            except Exception as exc:  # noqa: BLE001
                log.warning("learning hint failed: %s", exc)

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
                # Run one turn, streaming its provider response.
                for event in self._run_turn_stream(turn_idx):
                    yield event
                    if event.kind == "error":
                        finish_reason = "error"
                        error = event.data
                        break
                    if event.kind == "done":
                        # If the assembled response had tool calls, we
                        # continue to the next turn; otherwise we're done.
                        last_turn = self.turns[-1] if self.turns else None
                        if last_turn and not last_turn.response.is_tool_turn:
                            finish_reason = "complete"
                            break
                if finish_reason in ("complete", "cancelled", "error"):
                    break
            else:
                finish_reason = "loop_limit"
        except Exception as exc:  # noqa: BLE001
            finish_reason = "error"
            error = str(exc)
            log.exception("streaming agent error")
        finally:
            self.dispatcher.shutdown()

        total_dur = time.time() - self._start_ts
        emit(
            EventKind.AGENT_END,
            finish_reason=finish_reason,
            turns=len(self.turns),
            tokens=self._total_tokens,
            cost_usd=self._total_cost,
            duration_s=total_dur,
        )
        # Yield a final done event with the result summary.
        yield StreamEvent(kind="done", data=finish_reason,
                          usage={"tokens": self._total_tokens,
                                  "cost_usd": self._total_cost,
                                  "duration_s": total_dur,
                                  "turns": len(self.turns)})

    def _run_turn_stream(self, turn_idx: int) -> Iterator[StreamEvent]:
        """Run one turn, streaming the provider response."""
        with span("agent.turn", turn_idx=turn_idx):
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
                yield StreamEvent(kind="error",
                                  data=f"provider {model.provider!r} not available")
                return

            # 2. Context compaction.
            from kairo.agent.context import estimate_conversation_tokens
            ctx_tokens = estimate_conversation_tokens(self.messages, self.kcfg.context)
            compaction = self.context_mgr.maybe_compact(self.messages, model.context)
            if compaction.removed_count > 0:
                self.messages = compaction.messages
                ctx_tokens = compaction.tokens_after

            # 3. Inject orchestrator hint.
            request_messages = list(self.messages)
            if plan.system_hint:
                request_messages.insert(
                    0, Message(role=Role.SYSTEM, content=plan.system_hint,
                               meta={"phase": plan.phase}),
                )

            # 4. Tool list.
            tools = self._tools_for_phase(plan.phase)

            emit(
                EventKind.TURN_START,
                turn=turn_idx, phase=plan.phase,
                model=f"{model.provider}:{model.name}",
                reason=plan.decision.reason,
                est_tokens=ctx_tokens,
            )

            # 5. Call provider with streaming.
            from kairo.providers.openai import _msg_to_openai, _spec_to_openai
            from kairo.providers.anthropic import _msg_to_anthropic, _spec_to_anthropic
            body: dict = {
                "model": model.name,
                "messages": [_msg_to_openai(m) for m in request_messages],
                "temperature": 0.0,
                "stream": True,
            }
            if model.provider == "anthropic":
                # Anthropic streaming uses a different shape.
                chat_msgs = []
                sys_parts = []
                for m in request_messages:
                    if m.role == Role.SYSTEM:
                        if m.content:
                            sys_parts.append(m.content)
                    else:
                        role, content = _msg_to_anthropic(m)
                        chat_msgs.append({"role": role, "content": content})
                body = {
                    "model": model.name,
                    "messages": chat_msgs,
                    "max_tokens": 4096,
                    "temperature": 0.0,
                    "stream": True,
                }
                if sys_parts:
                    body["system"] = "\n\n".join(sys_parts)
                if tools:
                    body["tools"] = [_spec_to_anthropic(t) for t in tools]
                base_url = provider.cfg.base_url or "https://api.anthropic.com"
                headers = provider._default_headers()
            else:
                # OpenAI-compatible.
                if tools:
                    body["tools"] = [_spec_to_openai(t) for t in tools]
                base_url = provider._base_url()
                headers = provider._default_headers()
                if provider.cfg.api_key():
                    headers["Authorization"] = f"Bearer {provider.cfg.api_key()}"
                # GLM-specific extras.
                if model.provider == "glm":
                    import os
                    if os.environ.get("ZAI_TOKEN"):
                        headers["X-Token"] = os.environ["ZAI_TOKEN"]
                    headers["X-Z-AI-From"] = "Z"
                    body["thinking"] = {"type": "disabled"}

            # 6. Iterate the stream.
            events: list[StreamEvent] = []
            # Late-import the streaming function so test patches take effect.
            from kairo.providers import streaming as streaming_mod
            stream_fn = streaming_mod.stream_anthropic if model.provider == "anthropic" \
                else streaming_mod.stream_openai_compat
            with span("provider.complete", provider=model.provider,
                      model=model.name, phase=plan.phase, est_tokens=ctx_tokens):
                try:
                    for event in stream_fn(base_url=base_url, headers=headers, body=body):
                        events.append(event)
                        yield event
                        if event.kind == "error":
                            return
                except Exception as exc:  # noqa: BLE001
                    yield StreamEvent(kind="error", data=str(exc))
                    return

            # 7. Assemble the final response.
            assembled = assemble_stream(iter(events))
            if assembled.error:
                yield StreamEvent(kind="error", data=assembled.error)
                return
            response = ProviderResponse(
                content=assembled.text,
                tool_calls=assembled.tool_calls,
                usage=assembled.usage,
                model=model.name,
                finish_reason=assembled.finish_reason,
                latency_s=0.0,  # not tracked per-stream here
            )

            # 8. Track usage / cost.
            if response.usage:
                self._total_tokens += response.usage.get("total_tokens", 0)
            from kairo.agent.agent import _estimate_cost
            self._total_cost += _estimate_cost(response, model)

            # 9. Append assistant message.
            assistant_msg = Message(
                role=Role.ASSISTANT, content=response.content,
                tool_calls=response.tool_calls,
                meta={"provider": model.provider, "model": model.name,
                      "phase": plan.phase},
            )
            self.messages.append(assistant_msg)

            # 10. Tool-call grammar fallback (same as regular agent).
            if not response.tool_calls and response.content and tools:
                try:
                    from kairo.agent.tool_grammar import extract_tool_calls_grammar
                    grammar_result = extract_tool_calls_grammar(response.content, self.registry)
                    if grammar_result.calls:
                        response.tool_calls = grammar_result.calls
                        assistant_msg.tool_calls = grammar_result.calls
                except Exception as exc:  # noqa: BLE001
                    log.warning("tool_grammar fallback failed: %s", exc)

            # 11. Dispatch tool calls.
            tool_results: list[ToolResult] = []
            if response.tool_calls:
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
                if allowed_calls:
                    with span("tool.dispatch", call_count=len(allowed_calls)):
                        dispatch = self.dispatcher.dispatch(allowed_calls)
                    tool_results.extend(dispatch.results)
                for tr in tool_results:
                    self.safety.check_tool_output(tr)
                for tr in tool_results:
                    self.budget.record_call(tr.name)
                    self.messages.append(Message(role=Role.TOOL, tool_result=tr))

            # 12. Record the turn.
            ended = time.time()
            turn = AgentTurn(
                index=turn_idx, request_messages=request_messages,
                response=response, tool_results=tool_results,
                started_at=self._start_ts, ended_at=ended,
                model=model.name, provider=model.provider,
                router_reason=plan.decision.reason,
            )
            self.turns.append(turn)
            emit(
                EventKind.TURN_END, turn=turn_idx, phase=plan.phase,
                had_tool_calls=bool(response.tool_calls),
                tool_count=len(response.tool_calls or []),
                tokens=self._total_tokens, cost_usd=self._total_cost,
                duration_s=ended - self._start_ts,
            )
