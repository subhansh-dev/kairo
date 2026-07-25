"""Tool dispatcher — executes ToolCalls and returns ToolResults.

The dispatcher is the bridge between the model's tool calls and the
actual Python callables in the registry. It:
  * Runs pre-call hooks (permissions, etc.).
  * Handles sync vs async tools uniformly (we run async tools in an
    event loop so the agent loop itself can stay synchronous).
  * Catches all exceptions so a buggy tool never crashes the agent.
  * Runs tools in parallel when the agent loop asks for it (using a
    thread pool — async tools share the loop).
"""

from __future__ import annotations

import asyncio
import concurrent.futures as cf
import inspect
import time
import traceback
from dataclasses import dataclass
from typing import Any

from kairo.errors import GuardrailError, ToolError
from kairo.tools.base import RegisteredTool, ToolRegistry
from kairo.tools.guardrails import SpamGuard, screen_calls
from kairo.types import ToolCall, ToolResult, ToolSpec
from kairo.utils import get_logger, emit, EventKind

log = get_logger("agent.dispatcher")


@dataclass(slots=True)
class DispatchResult:
    """Outcome of dispatching a batch of tool calls."""

    results: list[ToolResult]
    # Calls that were blocked by guardrails (returned as error ToolResults).
    blocked: list[ToolResult]


class ToolDispatcher:
    """Dispatches ToolCalls to registered tools.

    Construction is cheap — only holds references. The agent loop creates
    one per run.
    """

    def __init__(
        self,
        registry: ToolRegistry,
        guard: SpamGuard,
        *,
        max_workers: int = 4,
    ) -> None:
        self.registry = registry
        self.guard = guard
        self.max_workers = max_workers
        self._pool = cf.ThreadPoolExecutor(max_workers=max_workers)

    # -- public API ----------------------------------------------------

    def dispatch(self, calls: list[ToolCall]) -> DispatchResult:
        """Run a batch of tool calls in parallel.

        Guardrail-blocked calls become ToolResult errors immediately
        (without invoking the tool) so the model can recover.
        """
        if not calls:
            return DispatchResult(results=[], blocked=[])

        schemas = {
            name: self.registry.get(name).spec.parameters
            for name in {call.name for call in calls}
            if self.registry.has(name)
        }
        screened = screen_calls(calls, self.guard, schemas)

        blocked_results: list[ToolResult] = []
        for call, err in screened.blocked:
            blocked_results.append(_block_to_result(call, err))

        allowed_results: list[ToolResult] = []
        if screened.allowed:
            # Submit all allowed calls in parallel.
            futures = {
                self._pool.submit(self._run_one, call): call
                for call in screened.allowed
            }
            for fut in cf.as_completed(futures):
                call = futures[fut]
                try:
                    allowed_results.append(fut.result())
                except Exception as exc:  # noqa: BLE001
                    allowed_results.append(_exc_to_result(call, exc))

        # Preserve original call order in the returned results.
        order = {c.id: i for i, c in enumerate(calls)}
        all_results = blocked_results + allowed_results
        all_results.sort(key=lambda r: order.get(r.call_id, 1_000_000))
        return DispatchResult(results=all_results, blocked=blocked_results)

    # -- internals -----------------------------------------------------

    def _run_one(self, call: ToolCall) -> ToolResult:
        """Run a single (allowed) tool call."""
        start = time.time()
        try:
            rt = self.registry.get(call.name)
        except ToolError as exc:
            return _exc_to_result(call, exc)

        # Pre-call hook.
        if rt.pre_call is not None:
            try:
                rt.pre_call(call.arguments)
            except Exception as exc:  # noqa: BLE001
                return ToolResult(
                    call_id=call.id,
                    name=call.name,
                    ok=False,
                    content=None,
                    error=f"pre_call rejected: {exc}",
                    duration_s=time.time() - start,
                )

        emit(EventKind.TOOL_CALL, name=call.name, args=call.arguments, call_id=call.id)

        try:
            if rt.is_async:
                out = _run_async(rt.fn, call.arguments)
            else:
                out = rt.fn(**call.arguments)
            ok = True
            err = None
        except Exception as exc:  # noqa: BLE001
            out = None
            ok = False
            err = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-800:]}"
            log.warning("tool %s failed: %s", call.name, exc)

        result = ToolResult(
            call_id=call.id,
            name=call.name,
            ok=ok,
            content=out,
            error=err,
            duration_s=time.time() - start,
        )
        emit(EventKind.TOOL_RESULT, name=call.name, ok=ok, call_id=call.id,
             duration_s=result.duration_s)
        return result

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_async(fn, args: dict[str, Any]) -> Any:
    """Run an async tool function in a fresh event loop."""
    try:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(fn(args))
        finally:
            loop.close()
    except RuntimeError:
        # Fallback: try asyncio.run (Python 3.10+).
        return asyncio.run(fn(args))


def _block_to_result(call: ToolCall, err: GuardrailError) -> ToolResult:
    return ToolResult(
        call_id=call.id,
        name=call.name,
        ok=False,
        content=None,
        error=f"GUARDRAIL [{err.rule}]: {err}",
    )


def _exc_to_result(call: ToolCall, exc: Exception) -> ToolResult:
    msg = str(exc)
    return ToolResult(
        call_id=call.id,
        name=call.name,
        ok=False,
        content=None,
        error=f"{type(exc).__name__}: {msg}",
    )
