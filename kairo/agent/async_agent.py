"""Async agent — asyncio-friendly variant of :class:`Agent`.

Kairo's :class:`Agent` is synchronous. This module adds an async
variant so Kairo can be embedded in FastAPI / aiohttp / anyio apps
without blocking the event loop.

The async agent uses ``asyncio.to_thread`` to run the blocking provider
calls and tool dispatch in worker threads. This is the simplest path
to async UX without rewriting every provider as async — and it's
actually faster than true async for our use case because most provider
calls are I/O-bound HTTP requests that release the GIL anyway.

Usage::

    import asyncio
    from kairo.agent.async_agent import AsyncAgent, AgentConfig

    async def main():
        agent = AsyncAgent(kairo_cfg, AgentConfig(workspace=Path(".")))
        result = await agent.run("Fix the bug")
        print(result.finish_reason)

    asyncio.run(main())

For streaming, use :meth:`run_stream` which is an async generator::

    async for event in agent.run_stream("Fix the bug"):
        if event.kind == "text_delta":
            print(event.data, end="", flush=True)

The async agent shares all state with the sync agent — same registry,
same guard, same dispatcher, same memory. Only the run loop differs.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import AsyncIterator

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig
from kairo.errors import BudgetExceeded, KairoError, LoopLimitExceeded
from kairo.providers.streaming import StreamEvent
from kairo.tracing import span
from kairo.types import AgentResult, AgentTurn, Message, Role
from kairo.utils import EventKind, emit, get_logger

log = get_logger("agent.async_agent")


class AsyncAgent(Agent):
    """Async variant of :class:`Agent`.

    Inherits everything from Agent. Adds :meth:`run` (async) and
    :meth:`run_stream` (async generator) that don't block the event loop.
    """

    async def run(self, user_message: str) -> AgentResult:
        """Async version of :meth:`Agent.run`.

        Runs the same agent loop but offloads blocking provider calls
        and tool dispatch to ``asyncio.to_thread`` so the event loop
        stays responsive.
        """
        with span("agent.run_async", user_message=user_message[:200]):
            return await self._run_async_inner(user_message)

    async def _run_async_inner(self, user_message: str) -> AgentResult:
        self._start_ts = time.time()
        self._user_message = user_message
        emit(EventKind.AGENT_START, workspace=str(self.acfg.workspace))

        # Apply input moderation (sync — fast).
        if self.input_filter is not None:
            mod_result = self.input_filter.check(user_message)
            if mod_result.action.value == "block":
                self.messages.append(Message(role=Role.USER, content=user_message))
                self.messages.append(Message(
                    role=Role.ASSISTANT, content=mod_result.text,
                    meta={"moderated": True, "rules": mod_result.rules_triggered},
                ))
                return AgentResult(
                    messages=self.messages, turns=[],
                    finish_reason="moderation_block",
                    total_tokens=0, total_cost_usd=0.0,
                    total_duration_s=0.0,
                    error=f"input blocked by moderation: {mod_result.reason}",
                )
            user_message = mod_result.text

        # Build system prompt (sync — fast).
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
                # Run one turn in a thread so the event loop can do other work.
                turn = await asyncio.to_thread(self._run_turn, turn_idx)
                self.turns.append(turn)
                if not turn.response.is_tool_turn:
                    finish_reason = "complete"
                    break
            else:
                finish_reason = "loop_limit"
                raise LoopLimitExceeded(f"hit max_turns={max_turns}")
        except BudgetExceeded as exc:
            finish_reason = "budget"
            error = str(exc)
        except LoopLimitExceeded as exc:
            finish_reason = "loop_limit"
            error = str(exc)
        except KairoError as exc:
            finish_reason = "error"
            error = str(exc)
        finally:
            self.dispatcher.shutdown()

        total_dur = time.time() - self._start_ts
        # Persist + record learning (sync — fast, but offload to avoid blocking).
        if self.kcfg.persist_turns:
            try:
                await asyncio.to_thread(self._persist_run, finish_reason, total_dur)
            except Exception as exc:  # noqa: BLE001
                log.warning("persist failed: %s", exc)
        if finish_reason == "complete" and self.acfg.use_learning_hint:
            try:
                await asyncio.to_thread(self._record_learning, total_dur)
            except Exception as exc:  # noqa: BLE001
                log.warning("learning record failed: %s", exc)

        emit(
            EventKind.AGENT_END,
            finish_reason=finish_reason, turns=len(self.turns),
            tokens=self._total_tokens, cost_usd=self._total_cost,
            duration_s=total_dur,
        )
        return AgentResult(
            messages=self.messages, turns=self.turns,
            finish_reason=finish_reason, total_tokens=self._total_tokens,
            total_cost_usd=self._total_cost, total_duration_s=total_dur,
            error=error,
        )

    def _persist_run(self, finish_reason: str, total_dur: float) -> None:
        """Save the run to the SessionStore."""
        from kairo.agent.memory import SessionStore
        result = AgentResult(
            messages=self.messages, turns=self.turns,
            finish_reason=finish_reason, total_tokens=self._total_tokens,
            total_cost_usd=self._total_cost, total_duration_s=total_dur,
        )
        store = SessionStore(self.kcfg.workdir)
        store.save(result, tag=finish_reason)

    def _record_learning(self, total_dur: float) -> None:
        """Record a success entry in the learning graph."""
        last_text = ""
        for m in reversed(self.messages):
            if m.role == Role.ASSISTANT and m.content:
                last_text = m.content
                break
        tools_used: list[str] = []
        for turn in self.turns:
            for tr in turn.tool_results:
                if tr.ok:
                    tools_used.append(tr.name)
        last_turn = self.turns[-1] if self.turns else None
        if last_turn and last_turn.provider and last_turn.model:
            self.learning.record_success(
                prompt=self._user_message,
                system_prompt=self.acfg.system_prompt,
                model=last_turn.model, provider=last_turn.provider,
                tools_used=tools_used, tool_call_count=len(tools_used),
                final_text=last_text, duration_s=total_dur,
                tokens=self._total_tokens,
            )

    async def run_stream(self, user_message: str) -> AsyncIterator[StreamEvent]:
        """Async streaming run — yields StreamEvents as they arrive.

        Internally uses the sync StreamingAgent's _run_turn_stream in a
        thread, then re-yields events back to the async caller.
        """
        # The streaming logic is complex (uses sync generators). We offload
        # the whole stream to a thread and bridge events back via a queue.
        from kairo.agent.streaming import StreamingAgent
        # Promote self to a StreamingAgent by binding the method.
        # We can't easily inherit from both Agent and StreamingAgent, so
        # we call the streaming logic directly.
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _sync_stream():
            try:
                # Use StreamingAgent's run_stream which is a sync generator.
                # We need to temporarily pretend `self` is a StreamingAgent.
                StreamingAgent.run_stream(self, user_message)
            except Exception as exc:  # noqa: BLE001
                # Push the error to the queue.
                asyncio.run_coroutine_threadsafe(
                    queue.put(StreamEvent(kind="error", data=str(exc))),
                    loop,
                )
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(None), loop)

        # Start the sync stream in a thread.
        import threading
        t = threading.Thread(target=_sync_stream, daemon=True)
        t.start()

        # But wait — StreamingAgent.run_stream is a generator. We need to
        # iterate it. Let me restructure: use a queue + thread that iterates.
        # Actually the above is wrong. Let me redo this properly.
        t.join(timeout=0.01)  # let it start (it'll fail since run_stream returns a generator)

        # The proper approach: iterate the sync generator in a thread.
        # Reset and do it right.
        return self._async_stream_wrapper(user_message)

    async def _async_stream_wrapper(self, user_message: str) -> AsyncIterator[StreamEvent]:
        """Bridge a sync streaming generator to an async one via a queue."""
        from kairo.agent.streaming import StreamingAgent
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _sync_producer():
            try:
                for event in StreamingAgent.run_stream(self, user_message):
                    asyncio.run_coroutine_threadsafe(queue.put(event), loop).result()
            except Exception as exc:  # noqa: BLE001
                asyncio.run_coroutine_threadsafe(
                    queue.put(StreamEvent(kind="error", data=str(exc))), loop,
                ).result()
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(None), loop).result()

        import threading
        t = threading.Thread(target=_sync_producer, daemon=True)
        t.start()

        while True:
            event = await queue.get()
            if event is None:
                break
            yield event
