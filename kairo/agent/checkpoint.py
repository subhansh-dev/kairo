"""Checkpoint/resume for agent runs — pause mid-run, continue later.

Kairo already persists *finished* runs to the SessionStore. This module
adds the ability to checkpoint a run *mid-flight* (after each turn)
and resume it later — even in a different process.

Use cases:
  * Long-running agent tasks that may exceed a request timeout.
  * Resuming an agent after a server restart.
  * Distributing agent work across multiple worker processes.

Implementation: :class:`CheckpointedAgent` wraps a regular :class:`Agent`
and saves a JSON checkpoint after every turn. The checkpoint contains
the full message history + turn log + budget state. To resume,
construct a new :class:`CheckpointedAgent` and call :meth:`resume`
with the checkpoint path.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig
from kairo.types import AgentResult, AgentTurn, Message, Role, ToolCall, ToolResult
from kairo.utils import get_logger

log = get_logger("agent.checkpoint")


@dataclass(slots=True)
class Checkpoint:
    """A snapshot of an agent run that can be resumed."""

    run_id: str
    user_message: str
    messages: list[Message]
    turns: list[AgentTurn]
    total_tokens: int
    total_cost_usd: float
    finish_reason: str | None  # None means still running
    saved_at: float
    agent_config: dict[str, Any]
    workspace: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "user_message": self.user_message,
            "messages": [_msg_to_dict(m) for m in self.messages],
            "turns": [_turn_to_dict(t) for t in self.turns],
            "total_tokens": self.total_tokens,
            "total_cost_usd": self.total_cost_usd,
            "finish_reason": self.finish_reason,
            "saved_at": self.saved_at,
            "agent_config": self.agent_config,
            "workspace": self.workspace,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Checkpoint":
        return cls(
            run_id=d["run_id"],
            user_message=d["user_message"],
            messages=[_msg_from_dict(m) for m in d.get("messages", [])],
            turns=[_turn_from_dict(t) for t in d.get("turns", [])],
            total_tokens=d.get("total_tokens", 0),
            total_cost_usd=d.get("total_cost_usd", 0.0),
            finish_reason=d.get("finish_reason"),
            saved_at=d.get("saved_at", time.time()),
            agent_config=d.get("agent_config", {}),
            workspace=d.get("workspace", ""),
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2, default=str))

    @classmethod
    def load(cls, path: Path) -> "Checkpoint":
        return cls.from_dict(json.loads(Path(path).read_text()))


def _msg_to_dict(m: Message) -> dict:
    d = {"role": m.role.value, "content": m.content}
    if m.tool_calls:
        d["tool_calls"] = [
            {"id": tc.id, "name": tc.name, "arguments": tc.arguments}
            for tc in m.tool_calls
        ]
    if m.tool_result is not None:
        d["tool_result"] = m.tool_result.to_message_payload()
    if m.name:
        d["name"] = m.name
    return d


def _msg_from_dict(d: dict) -> Message:
    tcs = []
    for tc in d.get("tool_calls", []):
        tcs.append(ToolCall(name=tc["name"], arguments=tc.get("arguments", {}),
                            id=tc.get("id", "")))
    tr = None
    if d.get("tool_result"):
        trd = d["tool_result"]
        tr = ToolResult(
            call_id=trd.get("call_id", ""),
            name=trd.get("name", ""),
            ok=trd.get("ok", False),
            content=trd.get("content"),
            error=trd.get("error"),
        )
    return Message(
        role=Role(d["role"]),
        content=d.get("content", ""),
        tool_calls=tcs,
        tool_result=tr,
        name=d.get("name"),
    )


def _turn_to_dict(t: AgentTurn) -> dict:
    return {
        "index": t.index,
        "response_content": t.response.content,
        "response_tool_calls": [
            {"id": tc.id, "name": tc.name, "arguments": tc.arguments}
            for tc in t.response.tool_calls
        ],
        "tool_results": [
            {
                "call_id": tr.call_id, "name": tr.name, "ok": tr.ok,
                "content": tr.content, "error": tr.error,
                "duration_s": tr.duration_s,
            }
            for tr in t.tool_results
        ],
        "model": t.model,
        "provider": t.provider,
        "started_at": t.started_at,
        "ended_at": t.ended_at,
    }


def _turn_from_dict(d: dict) -> AgentTurn:
    from kairo.types import ProviderResponse
    return AgentTurn(
        index=d["index"],
        request_messages=[],  # not serialized; can be reconstructed from messages
        response=ProviderResponse(
            content=d.get("response_content", ""),
            tool_calls=[
                ToolCall(name=tc["name"], arguments=tc.get("arguments", {}),
                         id=tc.get("id", ""))
                for tc in d.get("response_tool_calls", [])
            ],
        ),
        tool_results=[
            ToolResult(
                call_id=tr["call_id"], name=tr["name"], ok=tr["ok"],
                content=tr.get("content"), error=tr.get("error"),
                duration_s=tr.get("duration_s", 0.0),
            )
            for tr in d.get("tool_results", [])
        ],
        model=d.get("model"),
        provider=d.get("provider"),
        started_at=d.get("started_at", 0.0),
        ended_at=d.get("ended_at", 0.0),
    )


# ---------------------------------------------------------------------------
# CheckpointedAgent
# ---------------------------------------------------------------------------

class CheckpointedAgent:
    """Wraps an :class:`Agent` with after-every-turn checkpointing.

    Usage::

        ck_agent = CheckpointedAgent(kairo_cfg, agent_cfg, checkpoint_dir=Path("./ckpts"))
        result = ck_agent.run("Fix the bug")
        # If the process dies mid-run, the checkpoint at ./ckpts/<run_id>.json
        # can be resumed in a new process.

        # In a new process:
        ck_agent2 = CheckpointedAgent(kairo_cfg, agent_cfg, checkpoint_dir=Path("./ckpts"))
        result = ck_agent2.resume(Path("./ckpts/<run_id>.json"))

    Checkpoints are written after every turn, so the maximum lost work
    on a crash is one turn.
    """

    def __init__(
        self,
        kairo_cfg: KairoConfig,
        agent_cfg: AgentConfig,
        *,
        checkpoint_dir: Path,
    ) -> None:
        self.kcfg = kairo_cfg
        self.acfg = agent_cfg
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.run_id: str = uuid.uuid4().hex[:16]

    def _checkpoint_path(self) -> Path:
        return self.checkpoint_dir / f"{self.run_id}.json"

    def _make_checkpoint(self, agent: Agent, user_message: str,
                         finish_reason: str | None = None) -> Checkpoint:
        return Checkpoint(
            run_id=self.run_id,
            user_message=user_message,
            messages=list(agent.messages),
            turns=list(agent.turns),
            total_tokens=agent._total_tokens,
            total_cost_usd=agent._total_cost,
            finish_reason=finish_reason,
            saved_at=time.time(),
            agent_config={
                "workspace": str(self.acfg.workspace),
                "system_prompt": self.acfg.system_prompt,
                "max_turns": self.acfg.max_turns,
            },
            workspace=str(self.acfg.workspace),
        )

    def run(self, user_message: str) -> AgentResult:
        """Run the agent, checkpointing after every turn."""
        agent = Agent(self.kcfg, self.acfg)
        # Hook into the agent's turn log to save checkpoints.
        # We do this by wrapping _run_turn.
        original_run_turn = agent._run_turn

        def _checkpointed_run_turn(turn_idx: int) -> AgentTurn:
            turn = original_run_turn(turn_idx)
            # Save checkpoint after the turn.
            try:
                ckpt = self._make_checkpoint(agent, user_message, finish_reason=None)
                ckpt.save(self._checkpoint_path())
            except Exception as exc:  # noqa: BLE001
                log.warning("checkpoint save failed: %s", exc)
            return turn

        agent._run_turn = _checkpointed_run_turn  # type: ignore[method-assign]
        result = agent.run(user_message)
        # Final checkpoint with finish_reason set.
        try:
            ckpt = self._make_checkpoint(agent, user_message, finish_reason=result.finish_reason)
            ckpt.save(self._checkpoint_path())
        except Exception as exc:  # noqa: BLE001
            log.warning("final checkpoint save failed: %s", exc)
        return result

    def resume(self, checkpoint_path: Path) -> AgentResult:
        """Resume an agent run from a checkpoint.

        The agent will continue from where it left off — same message
        history, same accumulated turns, same budget state.
        """
        ckpt = Checkpoint.load(Path(checkpoint_path))
        self.run_id = ckpt.run_id
        agent = Agent(self.kcfg, self.acfg)
        # Restore state.
        agent.messages = list(ckpt.messages)
        agent.turns = list(ckpt.turns)
        agent._total_tokens = ckpt.total_tokens
        agent._total_cost = ckpt.total_cost_usd
        agent._user_message = ckpt.user_message
        agent._start_ts = time.time()  # reset start time for the resumed portion

        # Resume the loop from where we left off.
        max_turns = agent.budget.max_turns or self.kcfg.safety.max_turns
        next_turn_idx = len(ckpt.turns)
        finish_reason = "complete"
        error: str | None = None
        try:
            for turn_idx in range(next_turn_idx, max_turns):
                if agent._cancelled:
                    finish_reason = "cancelled"
                    break
                turn = agent._run_turn(turn_idx)
                agent.turns.append(turn)
                # Save checkpoint after each resumed turn.
                try:
                    resume_ckpt = self._make_checkpoint(agent, ckpt.user_message, finish_reason=None)
                    resume_ckpt.save(self._checkpoint_path())
                except Exception as exc:  # noqa: BLE001
                    log.warning("resume checkpoint failed: %s", exc)
                if not turn.response.is_tool_turn:
                    finish_reason = "complete"
                    break
            else:
                finish_reason = "loop_limit"
        except Exception as exc:  # noqa: BLE001
            finish_reason = "error"
            error = str(exc)
            log.exception("resumed agent error")
        finally:
            agent.dispatcher.shutdown()

        total_dur = time.time() - agent._start_ts
        result = AgentResult(
            messages=agent.messages,
            turns=agent.turns,
            finish_reason=finish_reason,
            total_tokens=agent._total_tokens,
            total_cost_usd=agent._total_cost,
            total_duration_s=total_dur,
            error=error,
        )
        # Final checkpoint.
        try:
            final_ckpt = self._make_checkpoint(agent, ckpt.user_message, finish_reason=finish_reason)
            final_ckpt.save(self._checkpoint_path())
        except Exception as exc:  # noqa: BLE001
            log.warning("final resume checkpoint failed: %s", exc)
        return result
