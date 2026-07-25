"""Persistent session memory + replay.

Kairo persists every agent run as a JSON file under ``workdir/runs/``.
Each file contains the full conversation, every turn's request/response,
tool results, and the final outcome. This lets you:

  * Replay a run to debug what the model did and why.
  * Resume a conversation by loading its messages into a new Agent.
  * Mine past runs for the self-improvement loop (failure patterns).
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from kairo.types import AgentResult, AgentTurn, Message, Role
from kairo.utils import get_logger

log = get_logger("agent.memory")


def _serialize(obj: Any) -> Any:
    if is_dataclass(obj):
        d = asdict(obj)
        return d
    if isinstance(obj, Role):
        return obj.value
    if isinstance(obj, (set, tuple)):
        return list(obj)
    if isinstance(obj, Path):
        return str(obj)
    return obj


def _sanitize(obj: Any) -> Any:
    """Recursively convert dataclasses/enums to plain JSON-friendly types."""
    if is_dataclass(obj):
        return {k: _sanitize(v) for k, v in asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, Role):
        return obj.value
    if isinstance(obj, Path):
        return str(obj)
    return obj


class SessionStore:
    """Persists agent runs to ``workdir/runs/<timestamp>.json``."""

    def __init__(self, workdir: Path) -> None:
        self.workdir = workdir
        self.runs_dir = workdir / "runs"
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def save(self, result: AgentResult, *, tag: str | None = None) -> Path:
        # Use millisecond resolution + a unique suffix so multiple saves
        # in the same second don't clobber each other.
        ts = int(time.time() * 1000)
        import uuid
        suffix = uuid.uuid4().hex[:6]
        fname = f"run_{ts}_{tag or 'untagged'}_{suffix}.json"
        path = self.runs_dir / fname
        # Compute analysis fields so the self-improvement loop can read
        # them directly without re-deriving from turns.
        analysis = analyze_run(result)
        payload = {
            "saved_at": ts,
            "tag": tag,
            "finish_reason": result.finish_reason,
            "total_tokens": result.total_tokens,
            "total_cost_usd": result.total_cost_usd,
            "total_duration_s": result.total_duration_s,
            "error": result.error,
            "messages": [_sanitize(m) for m in result.messages],
            "turns": [_sanitize(t) for t in result.turns],
            "tool_stats": analysis["tool_stats"],
            "guardrail_blocks": analysis["guardrail_blocks"],
            "unknown_tool_calls": analysis["unknown_tool_calls"],
            "health": analysis["health"],
        }
        path.write_text(json.dumps(payload, default=str, indent=2))
        log.info("saved run to %s (%d turns)", path, len(result.turns))
        return path

    def list_runs(self) -> list[Path]:
        return sorted(self.runs_dir.glob("run_*.json"))

    def load(self, path: Path) -> dict[str, Any]:
        return json.loads(path.read_text())

    def load_messages(self, path: Path) -> list[Message]:
        """Load a saved run's messages back into Message objects.

        Tool results and tool calls are reconstructed from their dict
        form. This is enough to resume a conversation in a new Agent.
        """
        data = self.load(path)
        msgs: list[Message] = []
        for m in data.get("messages", []):
            role = Role(m["role"])
            tcs = []
            for tc in m.get("tool_calls", []):
                from kairo.types import ToolCall
                tcs.append(ToolCall(
                    name=tc["name"],
                    arguments=tc.get("arguments", {}),
                    id=tc.get("id", ""),
                ))
            tr = None
            if m.get("tool_result"):
                from kairo.types import ToolResult
                trd = m["tool_result"]
                tr = ToolResult(
                    call_id=trd.get("call_id", ""),
                    name=trd.get("name", ""),
                    ok=trd.get("ok", False),
                    content=trd.get("content"),
                    error=trd.get("error"),
                )
            msgs.append(Message(
                role=role,
                content=m.get("content", ""),
                tool_calls=tcs,
                tool_result=tr,
                name=m.get("name"),
            ))
        return msgs


# ---------------------------------------------------------------------------
# Run analysis — feeds the self-improvement loop
# ---------------------------------------------------------------------------

def analyze_run(result: AgentResult) -> dict[str, Any]:
    """Produce a structured analysis of a finished run.

    The self-improvement loop consumes this to spot failure patterns:
    which tools failed most, which providers timed out, which task
    kinds hit loop limits, etc.

    Note: guardrail-blocked calls are tracked separately from real
    tool errors so the self-improvement loop can distinguish "the tool
    is broken" from "the model is spamming".
    """
    tool_stats: dict[str, dict[str, int]] = {}
    guardrail_blocks = 0
    unknown_tool_calls = 0
    for turn in result.turns:
        for tr in turn.tool_results:
            stats = tool_stats.setdefault(tr.name, {"ok": 0, "err": 0, "blocked": 0})
            if tr.ok:
                stats["ok"] += 1
            else:
                # Distinguish guardrail-blocked from genuine tool errors.
                if tr.error and "GUARDRAIL" in tr.error:
                    stats["blocked"] += 1
                    guardrail_blocks += 1
                elif tr.error and "not registered" in tr.error:
                    unknown_tool_calls += 1
                    # Don't count unknown-tool errors against this tool's
                    # error rate — they're a separate signal.
                else:
                    stats["err"] += 1

    return {
        "finish_reason": result.finish_reason,
        "turn_count": len(result.turns),
        "total_tokens": result.total_tokens,
        "total_cost_usd": result.total_cost_usd,
        "total_duration_s": result.total_duration_s,
        "tool_stats": tool_stats,
        "guardrail_blocks": guardrail_blocks,
        "unknown_tool_calls": unknown_tool_calls,
        "error": result.error,
        "health": _classify_health(result, guardrail_blocks, unknown_tool_calls),
    }


def _classify_health(result: AgentResult, blocks: int, unknown: int) -> str:
    """Coarse health label: healthy | degraded | failed."""
    if result.finish_reason == "complete" and blocks == 0 and unknown == 0:
        return "healthy"
    if result.finish_reason in ("loop_limit", "budget", "error"):
        return "failed"
    if blocks > 0 or unknown > 0:
        return "degraded"
    return "healthy"
