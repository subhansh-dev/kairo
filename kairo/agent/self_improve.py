"""Self-improvement loop — analyzes past runs and proposes fixes.

Kairo persists every run (see :mod:`kairo.agent.memory`). This module
mines those runs to spot recurring failure patterns and emits concrete
suggestions for fixing them: e.g. "model X keeps calling read_file on
nonexistent paths — add a 'list_dir first' instruction to the system
prompt" or "tool Y times out 30% of the time — increase its timeout".

The analyzer is intentionally read-only. It produces Suggestion objects;
applying them is up to the host application (or the agent itself in a
later meta-loop).
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from kairo.agent.memory import SessionStore, analyze_run
from kairo.types import AgentResult
from kairo.utils import get_logger

log = get_logger("agent.self_improve")


class SuggestionKind(str, Enum):
    SYSTEM_PROMPT = "system_prompt"      # tweak the system prompt
    TOOL_TIMEOUT = "tool_timeout"        # bump a tool's timeout
    TOOL_RENAME = "tool_rename"          # rename a tool for clarity
    TOOL_DESCRIPTION = "tool_description"  # rewrite a tool's description
    ROUTER_OVERRIDE = "router_override"  # force a model for a task kind
    SPAM_GUARD_TIGHTEN = "spam_guard_tighten"
    SPAM_GUARD_LOOSEN = "spam_guard_loosen"
    PROVIDER_FALLBACK = "provider_fallback"
    GENERIC = "generic"


@dataclass(slots=True)
class Suggestion:
    """A concrete, actionable improvement proposal."""

    kind: SuggestionKind
    title: str
    detail: str
    # Confidence in [0, 1] — higher = more evidence.
    confidence: float = 0.5
    # Which runs triggered this suggestion (paths).
    evidence: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "title": self.title,
            "detail": self.detail,
            "confidence": self.confidence,
            "evidence": self.evidence,
        }


@dataclass(slots=True)
class _RunSummary:
    """Compact per-run info used by the analyzers."""

    path: Path
    finish: str
    tokens: int
    duration_s: float
    tool_stats: dict[str, dict[str, int]]
    guardrail_blocks: int
    unknown_tool_calls: int
    health: str
    error: str | None
    # Last assistant message — for failure-mode categorization.
    last_text: str = ""


def _load_summaries(store: SessionStore, limit: int = 50) -> list[_RunSummary]:
    runs = store.list_runs()[-limit:]
    out: list[_RunSummary] = []
    for p in runs:
        try:
            data = store.load(p)
        except Exception:  # noqa: BLE001
            continue
        msgs = data.get("messages", [])
        last_text = ""
        for m in reversed(msgs):
            if m.get("role") == "assistant" and m.get("content"):
                last_text = m["content"]
                break
        out.append(_RunSummary(
            path=p,
            finish=data.get("finish_reason", "unknown"),
            tokens=data.get("total_tokens", 0),
            duration_s=data.get("total_duration_s", 0),
            tool_stats=data.get("tool_stats", {}) or _derive_tool_stats(data),
            guardrail_blocks=data.get("guardrail_blocks", 0),
            unknown_tool_calls=data.get("unknown_tool_calls", 0),
            health=data.get("health", "unknown"),
            error=data.get("error"),
            last_text=last_text[:500],
        ))
    return out


def _derive_tool_stats(data: dict) -> dict[str, dict[str, int]]:
    """Fallback when the saved run predates the analyzer fields."""
    stats: dict[str, dict[str, int]] = defaultdict(lambda: {"ok": 0, "err": 0})
    for t in data.get("turns", []):
        for tr in t.get("tool_results", []):
            name = tr.get("name", "?")
            if tr.get("ok"):
                stats[name]["ok"] += 1
            else:
                stats[name]["err"] += 1
    return dict(stats)


# ---------------------------------------------------------------------------
# Analyzers — each returns a list of Suggestions
# ---------------------------------------------------------------------------

def _check_repeated_unknown_tools(runs: list[_RunSummary]) -> list[Suggestion]:
    """Spot models trying to call tools that don't exist."""
    counts = Counter()
    evidence: dict[str, list[Path]] = defaultdict(list)
    for r in runs:
        if r.unknown_tool_calls > 0:
            # We don't know which tool names from the summary, but if any
            # unknown-tool errors happened we flag it.
            counts["unknown"] += r.unknown_tool_calls
            evidence["unknown"].append(r.path)
    if sum(counts.values()) < 3:
        return []
    return [Suggestion(
        kind=SuggestionKind.TOOL_RENAME,
        title="Model repeatedly calls unregistered tools",
        detail=(
            f"{sum(counts.values())} calls to unknown tools across "
            f"{len(evidence['unknown'])} runs. Inspect the run files to "
            "find which tool names the model is using, then either register "
            "those tools or update the system prompt to list the available "
            "tools explicitly."
        ),
        confidence=0.8,
        evidence=[str(p) for p in evidence["unknown"][:5]],
    )]


def _check_guardrail_pressure(runs: list[_RunSummary]) -> list[Suggestion]:
    """If the spam guard blocks a lot, the model is struggling — tighten
    the system prompt OR loosen the guard."""
    suggestions: list[Suggestion] = []
    total_blocks = sum(r.guardrail_blocks for r in runs)
    total_runs = len(runs)
    if total_runs == 0:
        return suggestions
    block_rate = total_blocks / total_runs
    if block_rate > 3.0:
        # Lots of repeats — the model doesn't know what to do.
        suggestions.append(Suggestion(
            kind=SuggestionKind.SPAM_GUARD_LOOSEN,
            title="High guardrail pressure — consider loosening spam guard",
            detail=(
                f"Average {block_rate:.1f} guardrail blocks per run. The "
                "model is making many repeated calls — likely because the "
                "task is under-specified. Either raise max_repeat_across_turns "
                "or improve the system prompt with explicit instructions."
            ),
            confidence=0.6,
            evidence=[str(r.path) for r in runs if r.guardrail_blocks > 0][:5],
        ))
    elif 0 < block_rate < 0.2 and total_runs > 10:
        # Very few blocks — the guard may be too loose to catch real spam.
        suggestions.append(Suggestion(
            kind=SuggestionKind.SPAM_GUARD_TIGHTEN,
            title="Few guardrail trips — consider tightening",
            detail=(
                f"Only {total_blocks} blocks across {total_runs} runs. "
                "If you're seeing runaway loops in production, lower "
                "max_repeat_across_turns to catch them earlier."
            ),
            confidence=0.3,
        ))
    return suggestions


def _check_tool_failure_rates(runs: list[_RunSummary]) -> list[Suggestion]:
    """Per-tool failure-rate analysis.

    Guardrail-blocked calls are excluded from the error rate — they
    indicate model misbehavior, not a broken tool.
    """
    suggestions: list[Suggestion] = []
    agg: dict[str, dict[str, int]] = defaultdict(lambda: {"ok": 0, "err": 0, "blocked": 0})
    evidence: dict[str, list[Path]] = defaultdict(list)
    for r in runs:
        for name, stats in r.tool_stats.items():
            agg[name]["ok"] += stats.get("ok", 0)
            agg[name]["err"] += stats.get("err", 0)
            agg[name]["blocked"] += stats.get("blocked", 0)
            if stats.get("err", 0) > 0:
                evidence[name].append(r.path)
    for name, stats in agg.items():
        # Only count ok + err (NOT blocked) toward the error rate.
        total = stats["ok"] + stats["err"]
        if total < 5:
            continue
        err_rate = stats["err"] / total
        if err_rate > 0.5:
            suggestions.append(Suggestion(
                kind=SuggestionKind.TOOL_DESCRIPTION,
                title=f"Tool {name!r} has high error rate ({err_rate:.0%})",
                detail=(
                    f"{stats['err']} of {total} calls to {name!r} failed. "
                    "The tool's description or argument schema may be "
                    "misleading the model. Rewrite the description to "
                    "clarify preconditions and required argument shapes."
                ),
                confidence=0.7,
                evidence=[str(p) for p in evidence[name][:5]],
            ))
    return suggestions


def _check_loop_limit_runs(runs: list[_RunSummary]) -> list[Suggestion]:
    """Runs that hit the loop limit often → router/model mismatch."""
    loop_limit_runs = [r for r in runs if r.finish == "loop_limit"]
    if len(loop_limit_runs) < 2:
        return []
    return [Suggestion(
        kind=SuggestionKind.ROUTER_OVERRIDE,
        title="Multiple runs hit loop_limit — model may be too weak",
        detail=(
            f"{len(loop_limit_runs)} runs reached the loop limit without "
            "completing. The current model may lack the capability for "
            "this task kind. Set RouterConfig.overrides to route to a "
            "stronger model and re-run."
        ),
        confidence=0.7,
        evidence=[str(r.path) for r in loop_limit_runs[:5]],
    )]


def _check_cost_outliers(runs: list[_RunSummary]) -> list[Suggestion]:
    """Spot runs that burned unusual tokens/cost."""
    if len(runs) < 5:
        return []
    tokens = sorted(r.tokens for r in runs)
    median = tokens[len(tokens) // 2]
    outliers = [r for r in runs if r.tokens > median * 5 and r.tokens > 10_000]
    if not outliers:
        return []
    return [Suggestion(
        kind=SuggestionKind.SYSTEM_PROMPT,
        title="Some runs consume 5x median tokens",
        detail=(
            f"{len(outliers)} runs used >5x the median token count "
            f"({median} tokens). The agent may be wandering — add a "
            "'be concise, do not repeat yourself' instruction to the "
            "system prompt."
        ),
        confidence=0.5,
        evidence=[str(r.path) for r in outliers[:5]],
    )]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_runs(workdir: Path, limit: int = 50) -> list[Suggestion]:
    """Analyze the last ``limit`` runs in ``workdir`` and return suggestions."""
    store = SessionStore(workdir)
    runs = _load_summaries(store, limit=limit)
    if not runs:
        return []
    out: list[Suggestion] = []
    out.extend(_check_repeated_unknown_tools(runs))
    out.extend(_check_guardrail_pressure(runs))
    out.extend(_check_tool_failure_rates(runs))
    out.extend(_check_loop_limit_runs(runs))
    out.extend(_check_cost_outliers(runs))
    # Sort by confidence descending.
    out.sort(key=lambda s: -s.confidence)
    return out


def format_suggestions(suggestions: list[Suggestion]) -> str:
    """Pretty-print suggestions for CLI display."""
    if not suggestions:
        return "No improvement suggestions — recent runs look healthy."
    lines = [f"Found {len(suggestions)} suggestion(s):\n"]
    for i, s in enumerate(suggestions, 1):
        lines.append(f"{i}. [{s.kind.value}] {s.title}")
        lines.append(f"   confidence: {s.confidence:.0%}")
        lines.append(f"   {s.detail}")
        if s.evidence:
            lines.append(f"   evidence: {len(s.evidence)} run(s)")
        lines.append("")
    return "\n".join(lines)
