"""Hard budget enforcement — stop the agent when spending limits are hit.

Kairo's :class:`Budget` is soft — it tracks usage but the agent loop
only checks ``max_turns`` and ``max_tokens`` lazily. In production you
often need *hard* limits:

  * "Never spend more than $5 per task."
  * "Never exceed 100K tokens per user per day."
  * "Never run more than 200 turns per hour."

This module provides :class:`BudgetEnforcer` — a thread-safe budget
tracker that the agent loop can call before each provider call to
check whether the call would exceed the limit. If yes, the agent loop
stops with ``finish_reason="budget"``.

Three enforcement levels:
  * ``per_run`` — limit applies to a single agent run.
  * ``per_user`` — limit applies to all runs by a user (persisted).
  * ``per_org`` — limit applies to all runs in an org (persisted).

Persistence is JSON-file based by default; swap in Redis/Postgres for
multi-process safety.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kairo.errors import BudgetExceeded
from kairo.utils import get_logger

log = get_logger("agent.budget_enforcer")


@dataclass(slots=True)
class BudgetLimit:
    """A single budget limit.

    Any field set to ``None`` means "no limit on this dimension".
    """

    max_cost_usd: float | None = None
    max_tokens: int | None = None
    max_turns: int | None = None
    max_wall_s: float | None = None


@dataclass(slots=True)
class BudgetUsage:
    """Current accumulated usage against a limit."""

    cost_usd: float = 0.0
    tokens: int = 0
    turns: int = 0
    wall_s: float = 0.0
    last_updated: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "cost_usd": self.cost_usd, "tokens": self.tokens,
            "turns": self.turns, "wall_s": self.wall_s,
            "last_updated": self.last_updated,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "BudgetUsage":
        return cls(
            cost_usd=d.get("cost_usd", 0.0),
            tokens=d.get("tokens", 0),
            turns=d.get("turns", 0),
            wall_s=d.get("wall_s", 0.0),
            last_updated=d.get("last_updated", time.time()),
        )


class BudgetEnforcer:
    """Thread-safe hard budget enforcement.

    Tracks usage by ``scope`` (e.g. "user:alice", "org:acme",
    "run:abc123"). Each scope has a :class:`BudgetLimit` and a
    :class:`BudgetUsage`. Before each provider call, call
    :meth:`check_and_reserve` to verify the call wouldn't exceed the
    limit. After the call, call :meth:`record_usage` to add the actual
    usage.

    Usage is persisted to a JSON file so limits survive across
    processes. For multi-process safety, swap in a real database.
    """

    def __init__(self, store_path: Path | None = None) -> None:
        self.store_path = store_path
        self._lock = threading.RLock()
        self._limits: dict[str, BudgetLimit] = {}
        self._usage: dict[str, BudgetUsage] = {}
        self._load()

    # -- limit management ----------------------------------------------

    def set_limit(self, scope: str, limit: BudgetLimit) -> None:
        with self._lock:
            self._limits[scope] = limit
            self._save()

    def get_limit(self, scope: str) -> BudgetLimit | None:
        with self._lock:
            return self._limits.get(scope)

    def remove_limit(self, scope: str) -> bool:
        with self._lock:
            existed = scope in self._limits
            self._limits.pop(scope, None)
            self._usage.pop(scope, None)
            if existed:
                self._save()
            return existed

    # -- usage tracking ------------------------------------------------

    def get_usage(self, scope: str) -> BudgetUsage:
        with self._lock:
            return self._usage.get(scope, BudgetUsage())

    def check_and_reserve(self, scope: str, *,
                          est_cost_usd: float = 0.0,
                          est_tokens: int = 0,
                          est_turns: int = 1,
                          est_wall_s: float = 0.0) -> None:
        """Check whether a planned call fits within the limit.

        Raises :class:`BudgetExceeded` if not. Does NOT mutate usage —
        call :meth:`record_usage` after the call with the actual numbers.
        """
        with self._lock:
            limit = self._limits.get(scope)
            usage = self._usage.get(scope, BudgetUsage())
            if limit is None:
                return  # no limit set
            new_cost = usage.cost_usd + est_cost_usd
            new_tokens = usage.tokens + est_tokens
            new_turns = usage.turns + est_turns
            new_wall = usage.wall_s + est_wall_s
            reasons: list[str] = []
            if limit.max_cost_usd is not None and new_cost > limit.max_cost_usd:
                reasons.append(
                    f"cost ${new_cost:.4f} > ${limit.max_cost_usd:.4f}"
                )
            if limit.max_tokens is not None and new_tokens > limit.max_tokens:
                reasons.append(
                    f"tokens {new_tokens} > {limit.max_tokens}"
                )
            if limit.max_turns is not None and new_turns > limit.max_turns:
                reasons.append(
                    f"turns {new_turns} > {limit.max_turns}"
                )
            if limit.max_wall_s is not None and new_wall > limit.max_wall_s:
                reasons.append(
                    f"wall {new_wall:.1f}s > {limit.max_wall_s:.1f}s"
                )
            if reasons:
                raise BudgetExceeded(
                    f"budget {scope!r} exceeded: " + "; ".join(reasons)
                )

    def record_usage(self, scope: str, *,
                     cost_usd: float = 0.0,
                     tokens: int = 0,
                     turns: int = 0,
                     wall_s: float = 0.0) -> BudgetUsage:
        """Add actual usage to the scope's accumulator."""
        with self._lock:
            usage = self._usage.get(scope, BudgetUsage())
            usage.cost_usd += cost_usd
            usage.tokens += tokens
            usage.turns += turns
            usage.wall_s += wall_s
            usage.last_updated = time.time()
            self._usage[scope] = usage
            self._save()
            return usage

    def reset_usage(self, scope: str) -> None:
        with self._lock:
            self._usage.pop(scope, None)
            self._save()

    def list_scopes(self) -> list[str]:
        with self._lock:
            return sorted(set(list(self._limits.keys()) + list(self._usage.keys())))

    # -- persistence ---------------------------------------------------

    def _load(self) -> None:
        if self.store_path is None or not self.store_path.is_file():
            return
        try:
            data = json.loads(self.store_path.read_text())
            for scope, lim in data.get("limits", {}).items():
                self._limits[scope] = BudgetLimit(**lim)
            for scope, u in data.get("usage", {}).items():
                self._usage[scope] = BudgetUsage.from_dict(u)
        except Exception as exc:  # noqa: BLE001
            log.warning("budget enforcer load failed: %s", exc)

    def _save(self) -> None:
        if self.store_path is None:
            return
        try:
            self.store_path.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "limits": {s: {"max_cost_usd": l.max_cost_usd,
                                "max_tokens": l.max_tokens,
                                "max_turns": l.max_turns,
                                "max_wall_s": l.max_wall_s}
                            for s, l in self._limits.items()},
                "usage": {s: u.to_dict() for s, u in self._usage.items()},
            }
            self.store_path.write_text(json.dumps(data, indent=2, default=str))
        except Exception as exc:  # noqa: BLE001
            log.warning("budget enforcer save failed: %s", exc)


# ---------------------------------------------------------------------------
# Convenience: default global enforcer
# ---------------------------------------------------------------------------

_global_enforcer: BudgetEnforcer | None = None


def get_global_enforcer() -> BudgetEnforcer:
    """Get the global BudgetEnforcer singleton."""
    global _global_enforcer
    if _global_enforcer is None:
        from kairo.config import load_config
        cfg = load_config()
        _global_enforcer = BudgetEnforcer(cfg.workdir / "budgets.json")
    return _global_enforcer
