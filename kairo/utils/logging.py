"""Logging and structured event capture for Kairo.

We use the stdlib ``logging`` module so Kairo plays nicely with host
applications. On top of that we expose :class:`EventBus` — a tiny
in-process pub/sub for structured events (tool called, model picked,
guardrail tripped, etc.) that the CLI/REPL can subscribe to for live UI
without scraping log lines.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
from collections import defaultdict
from dataclasses import asdict, is_dataclass
from enum import Enum
from typing import Any, Callable

from rich.logging import RichHandler

_KAIRO_LOGGER_NAME = "kairo"


class EventKind(str, Enum):
    AGENT_START = "agent.start"
    AGENT_END = "agent.end"
    TURN_START = "turn.start"
    TURN_END = "turn.end"
    ROUTER_PICK = "router.pick"
    TOOL_CALL = "tool.call"
    TOOL_RESULT = "tool.result"
    GUARDRAIL = "guardrail"
    PROVIDER = "provider"
    COMPACT = "context.compact"
    ERROR = "error"


class EventBus:
    """Minimal in-process pub/sub.

    Subscribers are called synchronously in subscription order. We
    deliberately avoid asyncio here so the bus can be used from sync and
    async code alike.
    """

    def __init__(self) -> None:
        self._subs: dict[EventKind, list[Callable[[dict], None]]] = defaultdict(list)
        self._lock = threading.Lock()

    def subscribe(self, kind: EventKind, fn: Callable[[dict], None]) -> Callable[[], None]:
        with self._lock:
            self._subs[kind].append(fn)
        def unsub() -> None:
            with self._lock:
                if fn in self._subs[kind]:
                    self._subs[kind].remove(fn)
        return unsub

    def publish(self, kind: EventKind, payload: dict | None = None) -> None:
        payload = payload or {}
        payload.setdefault("ts", time.time())
        payload.setdefault("kind", kind.value)
        with self._lock:
            subs = list(self._subs[kind])
        for fn in subs:
            try:
                fn(payload)
            except Exception:  # noqa: BLE001 — subscribers must not kill the bus
                logging.getLogger(_KAIRO_LOGGER_NAME).exception("event subscriber failed")


# Module-level singleton. Tests can replace this with a fresh bus.
_default_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    global _default_bus
    if _default_bus is None:
        _default_bus = EventBus()
    return _default_bus


def set_event_bus(bus: EventBus) -> None:
    global _default_bus
    _default_bus = bus


def configure_logging(level: str = "INFO") -> logging.Logger:
    """Configure the root ``kairo`` logger with a Rich handler.

    Safe to call multiple times — only the first call attaches a handler.
    """
    log = logging.getLogger(_KAIRO_LOGGER_NAME)
    if not getattr(log, "_kairo_configured", False):
        handler = RichHandler(
            show_time=True,
            show_level=True,
            show_path=False,
            markup=True,
            rich_tracebacks=True,
        )
        handler.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(handler)
        log._kairo_configured = True  # type: ignore[attr-defined]
    log.setLevel(level.upper())
    return log


def get_logger(name: str | None = None) -> logging.Logger:
    if name:
        return logging.getLogger(f"{_KAIRO_LOGGER_NAME}.{name}")
    return logging.getLogger(_KAIRO_LOGGER_NAME)


def _to_serializable(obj: Any) -> Any:
    if is_dataclass(obj):
        return asdict(obj)
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, (set, tuple)):
        return list(obj)
    return obj


def emit(kind: EventKind, **payload: Any) -> None:
    """Publish an event to the default bus, dataclasses auto-serialized."""
    clean = {k: _to_serializable(v) for k, v in payload.items()}
    get_event_bus().publish(kind, clean)


def log_event_json(kind: EventKind, payload: dict) -> None:
    """Emit an event AND write a JSON line to stderr for machine consumers."""
    emit(kind, **payload)
    sys.stderr.write(json.dumps({"event": kind.value, **payload}, default=str) + "\n")
    sys.stderr.flush()
