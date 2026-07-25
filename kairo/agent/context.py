"""Context-window manager — token estimation, compaction, summarization.

Kairo estimates tokens cheaply (heuristic tokens-per-char) rather than
calling a tokenizer for every provider. When the conversation exceeds
a configurable fraction of the active model's context window, the
manager compacts old turns into a single summary message.

Compaction strategy:
  1. Always keep the system prompt + first user message (the "anchor").
  2. Always keep the last N tool turns verbatim.
  3. Replace everything in between with a single ``system`` message:
     ``"Summary of prior conversation: ..."``. The summary is built
     from assistant text + tool-result contents; tool-call detail is
     dropped to save tokens.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from kairo.config import ContextConfig
from kairo.types import Message, Role, ToolCall, ToolResult
from kairo.utils import get_logger

log = get_logger("agent.context")


def estimate_tokens(text: str, cfg: ContextConfig) -> int:
    """Cheap token estimate. We round up so we err on the conservative side."""
    if not text:
        return 0
    return max(1, int(len(text) * cfg.tokens_per_char))


def estimate_message_tokens(m: Message, cfg: ContextConfig) -> int:
    """Token cost of a single message, including tool-call structure."""
    total = estimate_tokens(m.content, cfg)
    for tc in m.tool_calls:
        total += estimate_tokens(tc.name, cfg)
        total += estimate_tokens(json.dumps(tc.arguments, default=str), cfg)
    if m.tool_result is not None:
        total += estimate_tokens(_stringify(m.tool_result.content), cfg)
    return total + 4  # role tag overhead


def estimate_conversation_tokens(messages: list[Message], cfg: ContextConfig) -> int:
    return sum(estimate_message_tokens(m, cfg) for m in messages)


def _stringify(v) -> str:
    if isinstance(v, str):
        return v
    try:
        return json.dumps(v, default=str)
    except (TypeError, ValueError):
        return str(v)


@dataclass(slots=True)
class CompactionResult:
    """Output of a compaction pass."""

    messages: list[Message]
    summary: str | None
    removed_count: int
    tokens_before: int
    tokens_after: int


class ContextManager:
    """Stateful context manager.

    Holds the active ContextConfig. The agent loop calls
    :meth:`maybe_compact` after every turn; if the conversation is
    below the compaction threshold the call is a no-op.
    """

    def __init__(self, cfg: ContextConfig) -> None:
        self.cfg = cfg

    def needs_compaction(self, messages: list[Message], model_context: int) -> bool:
        tokens = estimate_conversation_tokens(messages, self.cfg)
        threshold = int(model_context * self.cfg.compact_at_fraction)
        return tokens >= threshold

    def maybe_compact(
        self,
        messages: list[Message],
        model_context: int,
    ) -> CompactionResult:
        tokens = estimate_conversation_tokens(messages, self.cfg)
        threshold = int(model_context * self.cfg.compact_at_fraction)
        if tokens < threshold:
            return CompactionResult(
                messages=messages,
                summary=None,
                removed_count=0,
                tokens_before=tokens,
                tokens_after=tokens,
            )
        return self.compact(messages)

    def compact(self, messages: list[Message]) -> CompactionResult:
        """Compact a conversation.

        Strategy (see module docstring). We never compact a conversation
        with fewer than ``keep_last_turns + 2`` messages — there's
        nothing to gain.
        """
        tokens_before = estimate_conversation_tokens(messages, self.cfg)
        n = len(messages)
        keep_last = self.cfg.keep_last_turns
        if n <= keep_last + 2:
            return CompactionResult(messages, None, 0, tokens_before, tokens_before)

        # Identify the anchor: system prompt(s) + first user message.
        anchor_end = 0
        seen_user = False
        for i, m in enumerate(messages):
            anchor_end = i + 1
            if m.role == Role.USER:
                seen_user = True
                break
        if not seen_user:
            # No user message yet; keep just the first message.
            anchor_end = 1

        # Middle slice: everything between anchor and the last `keep_last`.
        middle_start = anchor_end
        middle_end = max(middle_start, n - keep_last)
        middle = messages[middle_start:middle_end]
        tail = messages[middle_end:]

        summary_text = _summarize_middle(middle)
        summary_msg = Message(
            role=Role.SYSTEM,
            content=f"Summary of prior conversation (compacted):\n{summary_text}",
            meta={"compacted": True, "removed_count": len(middle)},
        )

        new_messages = [*messages[:anchor_end], summary_msg, *tail]
        tokens_after = estimate_conversation_tokens(new_messages, self.cfg)
        log.info(
            "compacted conversation: removed %d messages, %d -> %d tokens",
            len(middle), tokens_before, tokens_after,
        )
        return CompactionResult(
            messages=new_messages,
            summary=summary_text,
            removed_count=len(middle),
            tokens_before=tokens_before,
            tokens_after=tokens_after,
        )


def _summarize_middle(messages: list[Message]) -> str:
    """Build a compact summary string from a slice of messages.

    We preserve the order of events and include tool names + their
    results (truncated) so the model can still reference prior work
    without re-reading the full transcripts.
    """
    lines: list[str] = []
    for m in messages:
        if m.role == Role.SYSTEM:
            # Skip system prompts in the middle (they're usually anchor).
            continue
        if m.role == Role.USER:
            text = (m.content or "").strip()
            if text:
                lines.append(f"User: {text[:400]}")
            continue
        if m.role == Role.ASSISTANT:
            text = (m.content or "").strip()
            if text:
                lines.append(f"Assistant: {text[:400]}")
            for tc in m.tool_calls:
                lines.append(f"  -> called {tc.name}({_short_args(tc.arguments)})")
            continue
        if m.role == Role.TOOL and m.tool_result is not None:
            tr = m.tool_result
            content = _stringify(tr.content)
            if len(content) > 200:
                content = content[:200] + "..."
            tag = "ok" if tr.ok else "ERR"
            lines.append(f"  <- {tr.name} [{tag}]: {content}")
    if not lines:
        return "(nothing to summarize)"
    return "\n".join(lines)


def _short_args(args: dict) -> str:
    s = json.dumps(args, default=str)
    if len(s) > 80:
        return s[:77] + "..."
    return s
