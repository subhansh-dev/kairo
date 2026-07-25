"""Code-execution sandbox — smolagents-style Python interpreter for agents.

The smolagents pattern: instead of asking the model to emit tool calls,
ask it to emit Python code that calls Python functions (the tools). The
interpreter executes the code and returns the result. This is more
token-efficient than JSON tool schemas for complex workflows, and it
lets the model use control flow (loops, conditionals) over tools.

This module provides a *constrained* interpreter — not arbitrary
``exec``. The model can only call functions that have been registered
as tools. Imports, attribute access beyond the registered namespace,
and dangerous builtins are blocked.

Safety:
  * No ``import`` statements allowed.
  * No attribute access to dunder methods.
  * Only registered tool functions are accessible.
  * Output is captured stdout + the last expression's value.
  * Timeout enforced via signal (best-effort).
"""

from __future__ import annotations

import io
import signal
import sys
import traceback
from contextlib import redirect_stdout
from dataclasses import dataclass, field
from typing import Any, Callable

from kairo.errors import ToolError
from kairo.tools.base import ToolRegistry
from kairo.utils import get_logger

log = get_logger("tools.code_sandbox")


# Builtins allowed in the sandbox.
_SAFE_BUILTINS = {
    "print": print, "len": len, "range": range, "enumerate": enumerate,
    "zip": zip, "map": map, "filter": filter, "sorted": sorted,
    "reversed": reversed, "sum": sum, "min": min, "max": max,
    "abs": abs, "round": round, "any": any, "all": all,
    "list": list, "dict": dict, "set": set, "tuple": tuple,
    "str": str, "int": int, "float": float, "bool": bool,
    "isinstance": isinstance, "type": type, "True": True, "False": False,
    "None": None, "enumerate": enumerate,
}


@dataclass(slots=True)
class SandboxResult:
    """Outcome of running code in the sandbox."""

    stdout: str = ""
    result: Any = None
    error: str | None = None
    duration_s: float = 0.0
    lines_executed: int = 0


class CodeSandbox:
    """Constrained Python interpreter for agent-generated code.

    Build with a :class:`ToolRegistry`. The registered tools become
    callable names in the sandbox namespace. Execute code with
    :meth:`run`.
    """

    def __init__(self, registry: ToolRegistry, *, timeout_s: float = 10.0) -> None:
        self.registry = registry
        self.timeout_s = timeout_s
        self._namespace: dict[str, Any] = {}
        self._build_namespace()

    def _build_namespace(self) -> None:
        """Expose registered tools as plain functions in the namespace."""
        ns: dict[str, Any] = {"__builtins__": _SAFE_BUILTINS}
        for name in self.registry.names():
            rt = self.registry.get(name)
            # Wrap so the tool receives kwargs as a dict.
            ns[name] = self._make_wrapper(name, rt.fn, rt.is_async)
        self._namespace = ns

    def _make_wrapper(self, name: str, fn: Callable, is_async: bool) -> Callable:
        """Wrap a tool fn so it can be called from sync code in the sandbox."""
        if is_async:
            def _wrapper(*args, **kwargs):
                import asyncio
                loop = asyncio.new_event_loop()
                try:
                    return loop.run_until_complete(fn(kwargs))
                finally:
                    loop.close()
            return _wrapper
        def _wrapper(*args, **kwargs):
            # If called positionally, map args to parameter names.
            if args and not kwargs:
                import inspect
                sig = inspect.signature(fn)
                params = list(sig.parameters.keys())
                for i, a in enumerate(args):
                    if i < len(params):
                        kwargs[params[i]] = a
                return fn(**kwargs)
            return fn(**kwargs)
        _wrapper.__name__ = name
        _wrapper.__doc__ = (fn.__doc__ or "").strip()
        return _wrapper

    def run(self, code: str) -> SandboxResult:
        """Execute ``code`` in the sandbox. Returns :class:`SandboxResult`."""
        import time
        start = time.time()
        # Validate: no imports, no dunder access, no dangerous builtins.
        for bad in ("import ", "__", "exec(", "eval(", "open(", "compile(",
                    "globals(", "locals(", "vars(", "getattr(", "setattr("):
            if bad in code:
                return SandboxResult(
                    error=f"forbidden pattern in code: {bad!r}",
                    duration_s=time.time() - start,
                )
        # Capture stdout.
        buf = io.StringIO()
        # Set up timeout via signal (only works on main thread, Unix).
        old_handler = None
        try:
            old_handler = signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
            signal.setitimer(signal.ITIMER_REAL, self.timeout_s)
        except (ValueError, OSError):
            pass

        try:
            with redirect_stdout(buf):
                # Try eval first (single expression).
                result = None
                try:
                    expr = compile(code, "<sandbox>", "eval")
                    result = eval(expr, self._namespace)
                except SyntaxError:
                    # Multi-statement: exec, then try to capture the last
                    # expression by re-compiling it as eval.
                    compiled = compile(code, "<sandbox>", "exec")
                    exec(compiled, self._namespace)
                    # Try to extract the last expression statement's value.
                    result = self._eval_last_expression(code)
            return SandboxResult(
                stdout=buf.getvalue(),
                result=result,
                duration_s=time.time() - start,
                lines_executed=code.count("\n") + 1,
            )
        except TimeoutError:
            return SandboxResult(
                stdout=buf.getvalue(),
                error=f"timed out after {self.timeout_s}s",
                duration_s=time.time() - start,
            )
        except Exception as exc:  # noqa: BLE001
            tb = traceback.format_exc()[-800:]
            return SandboxResult(
                stdout=buf.getvalue(),
                error=f"{type(exc).__name__}: {exc}\n{tb}",
                duration_s=time.time() - start,
            )
        finally:
            if old_handler is not None:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, old_handler)

    def _eval_last_expression(self, code: str) -> Any:
        """Try to evaluate the last line of ``code`` as an expression.

        Returns the value, or None if the last line isn't an expression.
        """
        lines = code.strip().splitlines()
        if not lines:
            return None
        last = lines[-1].strip()
        if not last or last.endswith(":") or last.startswith(("def ", "class ", "for ", "while ", "if ")):
            return None
        try:
            return eval(compile(last, "<sandbox-last>", "eval"), self._namespace)
        except Exception:  # noqa: BLE001
            return None
