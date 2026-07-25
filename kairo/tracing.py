"""Tracing — lightweight OpenTelemetry-style spans for Kairo.

Spans are emitted to the EventBus as ``trace.span`` events. Subscribers
can forward them to OTLP/Jaeger/Zipkin/etc. for visualization.

A span captures:
  * name (e.g. "agent.turn", "tool.call", "provider.complete")
  * start/end timestamps
  * attributes (free-form dict)
  * parent span id (for nested spans)
  * status: "ok" | "error"
  * error message (when status == "error")

Usage::

    from kairo.tracing import span

    with span("agent.turn", turn_idx=3, model="glm:glm-4.6"):
        ... do work ...

The context manager auto-closes the span and emits the event. Errors
are caught, recorded, and re-raised.
"""

from __future__ import annotations

import contextlib
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterator

from kairo.utils import EventKind, emit, get_event_bus, get_logger

log = get_logger("tracing")


# We add a custom event kind for spans. Reusing the EventBus lets
# subscribers subscribe to spans exactly like any other event.
def _span_event(payload: dict) -> None:
    """Publish a span as a generic event on the bus."""
    get_event_bus().publish(EventKind.TOOL_CALL, payload)  # reuse bus


@dataclass(slots=True)
class Span:
    """A single tracing span."""

    name: str
    attributes: dict[str, Any] = field(default_factory=dict)
    start_ts: float = 0.0
    end_ts: float = 0.0
    span_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    parent_id: str | None = None
    status: str = "ok"  # "ok" | "error"
    error: str | None = None

    @property
    def duration_s(self) -> float:
        return max(0.0, self.end_ts - self.start_ts)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "span_id": self.span_id,
            "parent_id": self.parent_id,
            "start_ts": self.start_ts,
            "end_ts": self.end_ts,
            "duration_s": self.duration_s,
            "status": self.status,
            "error": self.error,
            "attributes": self.attributes,
        }


# Thread-local span stack so nested spans get the right parent.
_local = threading.local()


def _current_span() -> Span | None:
    stack = getattr(_local, "stack", None)
    if not stack:
        return None
    return stack[-1]


@contextlib.contextmanager
def span(name: str, **attributes: Any) -> Iterator[Span]:
    """Context manager that opens and closes a tracing span.

    The span is published to the EventBus on close. Errors are recorded
    as ``status="error"`` and re-raised.

    Example::

        with span("agent.turn", turn_idx=3):
            with span("tool.call", name="read_file"):
                ...
    """
    parent = _current_span()
    s = Span(
        name=name,
        attributes=attributes,
        start_ts=time.time(),
        parent_id=parent.span_id if parent else None,
    )
    stack = getattr(_local, "stack", None)
    if stack is None:
        stack = []
        _local.stack = stack
    stack.append(s)
    try:
        yield s
        s.status = "ok"
    except Exception as exc:  # noqa: BLE001
        s.status = "error"
        s.error = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        s.end_ts = time.time()
        stack.pop()
        # Publish as a tracing event.
        try:
            get_event_bus().publish(EventKind.TURN_END, s.to_dict())  # reuse bus
        except Exception:  # noqa: BLE001
            pass


def current_trace_id() -> str | None:
    """Return the trace id (root span id) for the current thread, or None."""
    stack = getattr(_local, "stack", None)
    if not stack:
        return None
    return stack[0].span_id


# ---------------------------------------------------------------------------
# Span collectors — for tests and in-process tracing
# ---------------------------------------------------------------------------

class SpanCollector:
    """Collects every span emitted during its lifetime.

    Useful for tests that want to assert on the span tree.

    Usage::

        with SpanCollector() as c:
            ... do work ...
        assert len(c.spans) == 3
        assert c.spans[0].name == "agent.turn"
    """

    def __init__(self) -> None:
        self.spans: list[Span] = []
        self._unsub: callable | None = None

    def __enter__(self) -> "SpanCollector":
        from kairo.utils import get_event_bus, EventKind
        def _on_span(payload: dict) -> None:
            # The span publisher reuses TURN_END with the span dict.
            # We rebuild a Span from the dict for convenience.
            self.spans.append(Span(
                name=payload.get("name", ""),
                attributes=payload.get("attributes", {}),
                start_ts=payload.get("start_ts", 0.0),
                end_ts=payload.get("end_ts", 0.0),
                span_id=payload.get("span_id", ""),
                parent_id=payload.get("parent_id"),
                status=payload.get("status", "ok"),
                error=payload.get("error"),
            ))
        self._unsub = get_event_bus().subscribe(EventKind.TURN_END, _on_span)
        return self

    def __exit__(self, *exc) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    def by_name(self, name: str) -> list[Span]:
        return [s for s in self.spans if s.name == name]

    def root_spans(self) -> list[Span]:
        return [s for s in self.spans if s.parent_id is None]


def format_trace(spans: list[Span]) -> str:
    """Pretty-print a list of spans as an indented tree."""
    by_id = {s.span_id: s for s in spans}
    children: dict[str | None, list[Span]] = {}
    for s in spans:
        children.setdefault(s.parent_id, []).append(s)

    lines: list[str] = []

    def _walk(parent_id: str | None, depth: int) -> None:
        for s in children.get(parent_id, []):
            tag = "✓" if s.status == "ok" else "✗"
            dur = f"{s.duration_s * 1000:.1f}ms" if s.duration_s > 0 else "—"
            lines.append(f"{'  ' * depth}{tag} {s.name}  ({dur})")
            if s.error:
                lines.append(f"{'  ' * (depth + 1)}err: {s.error[:100]}")
            _walk(s.span_id, depth + 1)

    _walk(None, 0)
    return "\n".join(lines)
