"""Anti-spam guardrails for tool calls.

Weak models love to:
  * emit the same tool call N times in one turn
  * emit the same tool call across consecutive turns
  * fan out dozens of parallel calls that don't depend on each other
  * call a tool with bad arguments, then immediately retry with the
    *same* bad arguments

This module catches all four patterns before they hit the dispatcher.
Each guardrail returns either ``None`` (allow) or a :class:`GuardrailError`
(block) — the agent loop converts blocks into structured ``ToolResult``
errors so the model can recover on the next turn.
"""

from __future__ import annotations

import threading
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Iterable

from kairo.errors import GuardrailError
from kairo.types import ToolCall


@dataclass(slots=True)
class SpamGuardConfig:
    """Tunables for :class:`SpamGuard`.

    Defaults are deliberately permissive — Kairo is designed to run on
    free open-weight models which can be noisier than frontier paid
    APIs. The guard catches blatant runaway loops while still letting
    the model retry legitimate calls a few times.
    """

    # Max identical (name+args) calls per turn.
    max_repeat_per_turn: int = 2
    # Max identical calls across consecutive turns.
    max_repeat_across_turns: int = 4
    # How many turns back to consider for "across turns" dedup.
    across_turns_window: int = 4
    # Hard cap on total tool calls in a single turn.
    max_calls_per_turn: int = 20
    # Debounce: minimum seconds between two identical calls.
    debounce_s: float = 0.0
    # Per-tool call caps. Maps tool name -> max calls per run.
    per_tool_caps: dict[str, int] = field(default_factory=dict)


class SpamGuard:
    """Stateful anti-spam guardrail.

    The guard keeps a sliding window of recent fingerprints per turn so
    it can detect repeats both within a turn and across turns. It is
    thread-safe — the agent loop may dispatch parallel calls but always
    asks the guard to bless each one first.
    """

    def __init__(self, cfg: SpamGuardConfig | None = None) -> None:
        self.cfg = cfg or SpamGuardConfig()
        self._lock = threading.RLock()
        # Per-turn counter of fingerprints.
        self._turn_counts: Counter[str] = Counter()
        # Sliding window of (turn_index, fingerprint) tuples.
        self._history: deque[tuple[int, str]] = deque()
        self._last_call_ts: dict[str, float] = {}
        self._per_tool_total: Counter[str] = Counter()
        self._current_turn = 0

    # -- lifecycle -----------------------------------------------------

    def begin_turn(self) -> None:
        """Advance the turn counter and trim the history window."""
        with self._lock:
            self._current_turn += 1
            self._turn_counts.clear()
            cutoff = self._current_turn - self.cfg.across_turns_window
            while self._history and self._history[0][0] < cutoff:
                self._history.popleft()

    # -- per-call check ------------------------------------------------

    def check(self, call: ToolCall) -> GuardrailError | None:
        """Return a GuardrailError if ``call`` should be blocked, else None."""
        fp = call.fingerprint()
        now = time.time()
        with self._lock:
            # Per-tool hard cap.
            cap = self.cfg.per_tool_caps.get(call.name)
            if cap is not None and self._per_tool_total.get(call.name, 0) >= cap:
                return GuardrailError(
                    "per_tool_cap",
                    f"Tool {call.name!r} hit its per-run cap of {cap} call(s)",
                )

            # Per-turn total.
            if sum(self._turn_counts.values()) >= self.cfg.max_calls_per_turn:
                return GuardrailError(
                    "per_turn_cap",
                    f"Turn already issued {self.cfg.max_calls_per_turn} tool calls; "
                    "stop calling tools and produce a final answer",
                )

            # Per-turn repeat.
            if self._turn_counts[fp] >= self.cfg.max_repeat_per_turn:
                return GuardrailError(
                    "repeat_in_turn",
                    f"Tool {call.name!r} was already called with these exact arguments "
                    f"this turn; do not repeat",
                )

            # Across-turn repeat.
            recent = sum(1 for _, h in self._history if h == fp)
            if recent >= self.cfg.max_repeat_across_turns:
                return GuardrailError(
                    "repeat_across_turns",
                    f"Tool {call.name!r} has been called with these exact arguments "
                    f"{recent} times in the last {self.cfg.across_turns_window} turns; "
                    "stop retrying and change your approach",
                )

            # Debounce.
            if self.cfg.debounce_s > 0:
                last = self._last_call_ts.get(fp, 0.0)
                if now - last < self.cfg.debounce_s:
                    return GuardrailError(
                        "debounce",
                        f"Tool {call.name!r} called too quickly after an identical call; "
                        f"wait {self.cfg.debounce_s:.2f}s or change arguments",
                    )

            # All clear — record.
            self._turn_counts[fp] += 1
            self._history.append((self._current_turn, fp))
            self._last_call_ts[fp] = now
            self._per_tool_total[call.name] += 1
            return None

    # -- inspection ----------------------------------------------------

    def turn_stats(self) -> dict[str, int]:
        with self._lock:
            return dict(self._turn_counts)

    def total_calls(self, name: str) -> int:
        with self._lock:
            return self._per_tool_total.get(name, 0)

    def reset(self) -> None:
        with self._lock:
            self._turn_counts.clear()
            self._history.clear()
            self._last_call_ts.clear()
            self._per_tool_total.clear()
            self._current_turn = 0


# ---------------------------------------------------------------------------
# Argument validation
# ---------------------------------------------------------------------------

def validate_arguments(call: ToolCall, schema: dict) -> GuardrailError | None:
    """Lightweight JSON-Schema-ish argument validation.

    We don't pull in ``jsonschema`` for every call (it's heavy). Instead
    we do a fast structural check on type + required keys, which catches
    95% of model mistakes. ``jsonschema`` is reserved for the validator
    module used at registration time.
    """
    props = schema.get("properties", {})
    required = schema.get("required", [])
    for req in required:
        if req not in call.arguments:
            return GuardrailError(
                "missing_arg",
                f"Tool {call.name!r} missing required argument {req!r}",
            )
    for key, val in call.arguments.items():
        if key not in props:
            # Unknown arg — allow it (model may know better than schema).
            continue
        expected_type = props[key].get("type")
        if expected_type and not _matches_type(val, expected_type):
            return GuardrailError(
                "bad_arg_type",
                f"Tool {call.name!r} argument {key!r} expected {expected_type}, "
                f"got {type(val).__name__}",
            )
    return None


def _matches_type(value, expected: str) -> bool:
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "null":
        return value is None
    return True


# ---------------------------------------------------------------------------
# Composite guard — runs all checks in order
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class GuardResult:
    allowed: list[ToolCall]
    blocked: list[tuple[ToolCall, GuardrailError]]


def screen_calls(
    calls: Iterable[ToolCall],
    guard: SpamGuard,
    schemas: dict[str, dict] | None = None,
) -> GuardResult:
    """Run a batch of calls through the spam guard + arg validator.

    Calls are screened in order. Allowed calls are returned in order;
    blocked calls are returned with their reasons so the caller can feed
    structured errors back to the model.
    """
    allowed: list[ToolCall] = []
    blocked: list[tuple[ToolCall, GuardrailError]] = []
    for call in calls:
        if schemas and call.name in schemas:
            err = validate_arguments(call, schemas[call.name])
            if err is not None:
                blocked.append((call, err))
                continue
        err = guard.check(call)
        if err is not None:
            blocked.append((call, err))
        else:
            allowed.append(call)
    return GuardResult(allowed=allowed, blocked=blocked)
