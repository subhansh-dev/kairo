"""Tool base classes and registry.

A Kairo tool is a callable with:
  * a JSON-Schema parameter spec (:class:`ToolSpec`)
  * a Python function that executes the call
  * optional per-call hooks for caching, retries, etc.

The registry is intentionally minimal — providers query it for the schema
list to send to the model, and the agent loop queries it to dispatch the
actual call.
"""

from __future__ import annotations

import inspect
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

from kairo.errors import ToolNotFoundError
from kairo.types import ToolSpec


# A tool callable can be sync or async. The dispatcher handles both.
ToolCallable = Callable[[dict[str, Any]], Any]
AsyncToolCallable = Callable[[dict[str, Any]], Awaitable[Any]]


@dataclass(slots=True)
class RegisteredTool:
    """A tool + its spec + its callable."""

    spec: ToolSpec
    fn: ToolCallable | AsyncToolCallable
    # Whether ``fn`` is a coroutine function (async def).
    is_async: bool = False
    # Optional pre-call hook (e.g. for permission checks). Receives the
    # raw arguments and may raise to abort.
    pre_call: Callable[[dict[str, Any]], None] | None = None


class ToolRegistry:
    """Thread-safe registry of tools.

    The registry stores tools by name. Names are case-sensitive and must
    be unique — registering a duplicate name replaces the prior entry
    with a warning, mirroring how langchain's ``@tool`` decorator behaves.
    """

    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}
        self._lock = threading.RLock()

    # -- registration --------------------------------------------------

    def register(
        self,
        name: str,
        fn: ToolCallable | AsyncToolCallable,
        *,
        description: str = "",
        parameters: dict[str, Any] | None = None,
        max_calls_per_run: int | None = None,
        max_calls_per_turn: int | None = None,
        tags: tuple[str, ...] = (),
        pre_call: Callable[[dict[str, Any]], None] | None = None,
    ) -> RegisteredTool:
        if not name:
            raise ValueError("Tool name must be non-empty")
        if parameters is None:
            parameters = _infer_schema(fn)
        if not description:
            description = (inspect.getdoc(fn) or "").strip() or f"Tool {name}"
        spec = ToolSpec(
            name=name,
            description=description,
            parameters=parameters,
            max_calls_per_run=max_calls_per_run,
            max_calls_per_turn=max_calls_per_turn,
            tags=tags,
        )
        is_async = inspect.iscoroutinefunction(fn)
        rt = RegisteredTool(spec=spec, fn=fn, is_async=is_async, pre_call=pre_call)
        with self._lock:
            self._tools[name] = rt
        return rt

    def unregister(self, name: str) -> None:
        with self._lock:
            self._tools.pop(name, None)

    def get(self, name: str) -> RegisteredTool:
        with self._lock:
            rt = self._tools.get(name)
        if rt is None:
            raise ToolNotFoundError(name, f"Tool not registered: {name!r}")
        return rt

    def has(self, name: str) -> bool:
        with self._lock:
            return name in self._tools

    def names(self) -> list[str]:
        with self._lock:
            return sorted(self._tools.keys())

    def specs(self, names: list[str] | None = None) -> list[ToolSpec]:
        """Return ToolSpec list for the model, optionally filtered."""
        with self._lock:
            if names is None:
                return [rt.spec for rt in self._tools.values()]
            return [self._tools[n].spec for n in names if n in self._tools]

    def __len__(self) -> int:
        with self._lock:
            return len(self._tools)

    def __contains__(self, name: str) -> bool:
        return self.has(name)


# ---------------------------------------------------------------------------
# Schema inference
# ---------------------------------------------------------------------------

_PY_TO_JSON: dict[str, str] = {
    "str": "string",
    "int": "integer",
    "float": "number",
    "bool": "boolean",
    "list": "array",
    "dict": "object",
    "List": "array",
    "Dict": "object",
}


def _infer_schema(fn: ToolCallable | AsyncToolCallable) -> dict[str, Any]:
    """Infer a minimal JSON schema from a function's signature.

    This is deliberately conservative — we only emit a schema for
    parameters with explicit annotations. Unannotated params are
    treated as ``{"type": "string"}`` so the model at least has a hint.

    Handles ``from __future__ import annotations`` (PEP 563) by
    resolving string annotations via ``typing.get_type_hints`` with a
    string fallback for unresolvable names.
    """
    sig = inspect.signature(fn)
    # Resolve string annotations if PEP 563 is active.
    try:
        import typing
        hints = typing.get_type_hints(fn)
    except Exception:  # noqa: BLE001 — get_type_hints can fail on dynamic funcs
        hints = {}
    properties: dict[str, Any] = {}
    required: list[str] = []
    for pname, p in sig.parameters.items():
        if pname in ("self", "cls"):
            continue
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        annotation = hints.get(pname, p.annotation)
        if annotation is inspect.Parameter.empty:
            t = "string"
        else:
            t = _annotation_to_json_type(annotation)
        properties[pname] = {"type": t, "description": ""}
        if p.default is inspect.Parameter.empty:
            required.append(pname)
    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


def _annotation_to_json_type(ann: Any) -> str:
    if ann is type(None):
        return "null"
    if isinstance(ann, type):
        name = ann.__name__
        return _PY_TO_JSON.get(name, "string")
    if isinstance(ann, str):
        # PEP 563 string annotation. Strip " | None" / Optional wrappers
        # and look up the bare name; fall back to "string".
        s = ann.strip()
        for strip in ("| None", "|None", "None |", "None|"):
            s = s.replace(strip, "").strip()
        # Drop module prefix if present.
        s = s.rsplit(".", 1)[-1]
        return _PY_TO_JSON.get(s, "string")
    # typing.Optional / Union — pick the first non-None arm.
    origin = getattr(ann, "__origin__", None)
    if origin is not None:
        args = getattr(ann, "__args__", ())
        for a in args:
            if a is type(None):
                continue
            return _annotation_to_json_type(a)
    # types.UnionType (PEP 604): X | Y
    if hasattr(ann, "__args__"):
        args = getattr(ann, "__args__", ())
        for a in args:
            if a is type(None):
                continue
            return _annotation_to_json_type(a)
    return "string"


# ---------------------------------------------------------------------------
# Helpers for defining tools
# ---------------------------------------------------------------------------

def tool(
    name: str | None = None,
    *,
    description: str = "",
    parameters: dict[str, Any] | None = None,
    max_calls_per_run: int | None = None,
    max_calls_per_turn: int | None = None,
    tags: tuple[str, ...] = (),
) -> Callable[[ToolCallable | AsyncToolCallable], ToolCallable | AsyncToolCallable]:
    """Decorator that registers the wrapped function on a *default* registry.

    Usage::

        @tool(name="read_file", tags={"safe"})
        def read_file(path: str) -> str:
            ...

    The decorated function carries a ``_kairo_spec`` attribute so it can
    be added to any registry later via ``registry.register(**fn._kairo_spec)``.
    """

    def _wrap(fn: ToolCallable | AsyncToolCallable) -> ToolCallable | AsyncToolCallable:
        nonlocal name
        if name is None:
            name = fn.__name__
        if parameters is None:
            params = _infer_schema(fn)
        else:
            params = parameters
        if not description:
            doc = (inspect.getdoc(fn) or "").strip()
            desc = doc or f"Tool {name}"
        else:
            desc = description
        spec = ToolSpec(
            name=name,
            description=desc,
            parameters=params,
            max_calls_per_run=max_calls_per_run,
            max_calls_per_turn=max_calls_per_turn,
            tags=tags,
        )
        fn._kairo_spec = {  # type: ignore[attr-defined]
            "name": name,
            "description": desc,
            "parameters": params,
            "max_calls_per_run": max_calls_per_run,
            "max_calls_per_turn": max_calls_per_turn,
            "tags": tags,
        }
        fn._kairo_tool_spec = spec  # type: ignore[attr-defined]
        return fn

    return _wrap


def register_all(registry: ToolRegistry, *fns: ToolCallable | AsyncToolCallable) -> None:
    """Register every decorated ``@tool`` function into ``registry``."""
    for fn in fns:
        spec_kwargs = getattr(fn, "_kairo_spec", None)
        if spec_kwargs is None:
            raise ValueError(
                f"Function {fn!r} is not a @tool-decorated function. "
                "Use kairo.tools.tool() as a decorator first."
            )
        registry.register(fn=fn, **spec_kwargs)
