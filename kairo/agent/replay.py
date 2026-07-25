"""Agent replay — re-execute saved runs step-by-step for debugging.

Kairo persists every run as JSON. This module lets you load a saved
run and replay it turn-by-turn, optionally re-executing tool calls to
verify they still produce the same results. Useful for:

  * Debugging a failed run — step through each turn and see what happened.
  * Regression testing — replay a run against a new agent version and
    compare outcomes.
  * Demos — replay a run without burning tokens.

Two replay modes:
  * ``dry_run`` (default) — just print each turn's request/response/tools
    without calling any provider or tool. Fast, free, deterministic.
  * ``live_replay`` — re-execute tool calls against the current workspace
    and compare results to the saved ones. Still doesn't call the provider
    (the saved response is reused), but tool outputs are live.

Usage::

    from kairo.agent.replay import ReplayPlayer

    player = ReplayPlayer(Path("./runs/run_xxx.json"))
    for step in player.play():
        print(f"Turn {step.turn_idx}: {step.action}")
        if step.diff:
            print(f"  Diff: {step.diff}")
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Iterator

from kairo.tools.base import ToolRegistry
from kairo.utils import get_logger

log = get_logger("agent.replay")


class ReplayMode(str, Enum):
    DRY_RUN = "dry_run"       # just print, no execution
    LIVE_REPLAY = "live_replay"  # re-execute tools, compare results


@dataclass(slots=True)
class ReplayStep:
    """One step in a replay."""

    turn_idx: int
    action: str  # "provider_call", "tool_call", "tool_result", "turn_end"
    # Saved data from the original run.
    saved_data: dict = field(default_factory=dict)
    # Live data from the replay (when mode=LIVE_REPLAY).
    live_data: dict | None = None
    # Diff between saved and live (when they differ).
    diff: str | None = None
    # Any error during replay.
    error: str | None = None


class ReplayPlayer:
    """Loads a saved run and replays it step-by-step.

    Construct with a path to a saved run JSON file, then iterate over
    :meth:`play` to walk through each step.
    """

    def __init__(
        self,
        run_path: Path | str,
        *,
        registry: ToolRegistry | None = None,
        workspace: Path | None = None,
    ) -> None:
        self.run_path = Path(run_path)
        if not self.run_path.is_file():
            raise FileNotFoundError(f"run file not found: {self.run_path}")
        self.data: dict = json.loads(self.run_path.read_text())
        self.registry = registry
        self.workspace = workspace

    @property
    def finish_reason(self) -> str:
        return self.data.get("finish_reason", "unknown")

    @property
    def turn_count(self) -> int:
        return len(self.data.get("turns", []))

    @property
    def total_tokens(self) -> int:
        return self.data.get("total_tokens", 0)

    @property
    def total_cost_usd(self) -> float:
        return self.data.get("total_cost_usd", 0.0)

    def play(self, mode: ReplayMode = ReplayMode.DRY_RUN) -> Iterator[ReplayStep]:
        """Iterate over the run, yielding one :class:`ReplayStep` per action.

        Steps are yielded in chronological order: for each turn, the
        provider call is yielded first, then each tool call + result,
        then a turn_end marker.
        """
        turns = self.data.get("turns", [])
        for turn_idx, turn in enumerate(turns):
            # 1. Provider call.
            yield ReplayStep(
                turn_idx=turn_idx,
                action="provider_call",
                saved_data={
                    "model": turn.get("model"),
                    "provider": turn.get("provider"),
                    "phase": turn.get("phase"),
                    "response_content": (turn.get("response") or {}).get("content", ""),
                    "response_tool_calls": (turn.get("response") or {}).get("tool_calls", []),
                    "finish_reason": (turn.get("response") or {}).get("finish_reason"),
                },
            )

            # 2. Tool calls + results.
            tool_results = turn.get("tool_results", [])
            for tr in tool_results:
                step = ReplayStep(
                    turn_idx=turn_idx,
                    action="tool_call",
                    saved_data={
                        "name": tr.get("name"),
                        "call_id": tr.get("call_id"),
                        "ok": tr.get("ok"),
                        "content": tr.get("content"),
                        "error": tr.get("error"),
                        "duration_s": tr.get("duration_s", 0.0),
                    },
                )
                # In live-replay mode, re-execute the tool call.
                if mode == ReplayMode.LIVE_REPLAY and self.registry is not None and self.workspace:
                    step.live_data, step.diff, step.error = self._replay_tool_call(tr)
                yield step

            # 3. Turn end.
            yield ReplayStep(
                turn_idx=turn_idx,
                action="turn_end",
                saved_data={
                    "duration_s": (turn.get("ended_at", 0) - turn.get("started_at", 0)),
                },
            )

    def _replay_tool_call(self, tr: dict) -> tuple[dict | None, str | None, str | None]:
        """Re-execute a tool call and compare to the saved result.

        Returns (live_data, diff, error).
        """
        name = tr.get("name", "")
        if not self.registry or not self.registry.has(name):
            return None, None, f"tool {name!r} not in registry"
        # We need the original arguments. Look them up in the messages
        # of the saved run — find the assistant message whose tool_call
        # id matches tr.call_id.
        call_id = tr.get("call_id")
        args = self._find_tool_call_args(call_id)
        if args is None:
            return None, None, f"could not find args for call_id {call_id!r}"
        try:
            rt = self.registry.get(name)
            result = rt.fn(**args) if not rt.is_async else None
            if rt.is_async:
                import asyncio
                result = asyncio.new_event_loop().run_until_complete(rt.fn(args))
            live = {
                "name": name, "ok": True, "content": str(result),
                "error": None,
            }
            # Compare to saved.
            saved_content = str(tr.get("content", ""))
            live_content = str(result)
            if saved_content == live_content:
                return live, None, None
            diff = f"saved={saved_content[:200]!r} vs live={live_content[:200]!r}"
            return live, diff, None
        except Exception as exc:  # noqa: BLE001
            return None, None, f"replay failed: {exc}"

    def _find_tool_call_args(self, call_id: str) -> dict | None:
        """Find the arguments for a tool call by its id in the saved messages."""
        for msg in self.data.get("messages", []):
            for tc in msg.get("tool_calls", []):
                if tc.get("id") == call_id:
                    return tc.get("arguments", {})
        return None

    def summary(self) -> str:
        """Print a human-readable summary of the run."""
        lines = [
            f"Run: {self.run_path.name}",
            f"  Finish: {self.finish_reason}",
            f"  Turns:  {self.turn_count}",
            f"  Tokens: {self.total_tokens}",
            f"  Cost:   ${self.total_cost_usd:.4f}",
            "",
            "Per-turn summary:",
        ]
        for step in self.play():
            if step.action == "provider_call":
                model = step.saved_data.get("model", "?")
                phase = step.saved_data.get("phase", "?")
                content = step.saved_data.get("response_content", "")[:100]
                lines.append(f"  Turn {step.turn_idx}: [{phase}] {model}")
                if content:
                    lines.append(f"    → {content}")
            elif step.action == "tool_call":
                name = step.saved_data.get("name", "?")
                ok = "OK" if step.saved_data.get("ok") else "ERR"
                err = step.saved_data.get("error", "")
                lines.append(f"    tool: {name} [{ok}]" + (f" {err[:80]}" if err else ""))
                if step.diff:
                    lines.append(f"    DIFF: {step.diff[:120]}")
            elif step.action == "turn_end":
                dur = step.saved_data.get("duration_s", 0)
                lines.append(f"    (turn took {dur:.1f}s)")
        return "\n".join(lines)
