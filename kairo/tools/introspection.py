"""Agent introspection tools — let the agent inspect its own state.

These tools give the agent self-awareness of its run: how many turns
it has used, how many tokens it has consumed, what tools are available,
what the current message history looks like. Useful for:

  * The agent deciding whether to wrap up (it sees it has 3 turns left).
  * The agent picking the right tool (it sees what's available).
  * Debugging from inside the agent loop.

The tools are backed by closures over the agent's state, so they only
work when registered through :func:`make_introspection_tools` (which
takes the agent as a parameter).
"""

from __future__ import annotations

import json
from typing import Any, Callable

from kairo.tools.base import register_all, tool


def make_introspection_tools(state_provider: Callable[[], dict[str, Any]]):
    """Build introspection tools backed by ``state_provider``.

    ``state_provider`` is a zero-arg callable that returns a dict with
    keys like ``turns_used``, ``max_turns``, ``tokens_used``, ``tools``,
    ``messages``. The agent loop passes a closure that reads its own
    state.
    """

    @tool(name="self_status")
    def self_status() -> str:
        """Get the agent's current run status.

        Returns JSON with: turns_used, max_turns, tokens_used, cost_usd,
        tools_available, message_count, finish_reason (None if still running).
        """
        state = state_provider()
        return json.dumps({
            "turns_used": state.get("turns_used", 0),
            "max_turns": state.get("max_turns"),
            "tokens_used": state.get("tokens_used", 0),
            "cost_usd": state.get("cost_usd", 0.0),
            "tools_available": state.get("tools_available", []),
            "tool_count": len(state.get("tools_available", [])),
            "message_count": state.get("message_count", 0),
            "phase": state.get("phase"),
            "model": state.get("model"),
            "provider": state.get("provider"),
        }, indent=2)

    @tool(name="self_tools")
    def self_tools() -> str:
        """List the tools currently available to the agent.

        Returns one tool per line with its name + first-line description.
        """
        state = state_provider()
        tools = state.get("tools_available", [])
        if not tools:
            return "(no tools available)"
        lines = []
        for t in tools:
            name = t.get("name", "?")
            desc = (t.get("description") or "").split("\n")[0][:100]
            lines.append(f"- {name}: {desc}")
        return "\n".join(lines)

    @tool(name="self_history")
    def self_history(last_n: int = 5) -> str:
        """Get the last N messages from the conversation history.

        Args:
            last_n: How many messages to return (default 5).

        Returns one message per line: ``[role] content_preview``.
        """
        state = state_provider()
        messages = state.get("messages", [])
        if not messages:
            return "(no messages yet)"
        out = []
        for m in messages[-last_n:]:
            role = m.get("role", "?")
            content = m.get("content", "")
            if len(content) > 100:
                content = content[:100] + "..."
            tool_calls = m.get("tool_calls", [])
            if tool_calls:
                content += f" [tool_calls: {len(tool_calls)}]"
            tool_result = m.get("tool_result")
            if tool_result:
                content += f" [tool_result: {tool_result.get('name', '?')}]"
            out.append(f"[{role}] {content}")
        return "\n".join(out)

    @tool(name="self_budget")
    def self_budget() -> str:
        """Get the agent's remaining budget (turns + tokens + cost).

        Returns JSON with: turns_remaining, tokens_remaining (None if unlimited),
        cost_remaining_usd (None if unlimited).
        """
        state = state_provider()
        turns_used = state.get("turns_used", 0)
        max_turns = state.get("max_turns")
        tokens_used = state.get("tokens_used", 0)
        max_tokens = state.get("max_tokens")
        cost_used = state.get("cost_usd", 0.0)
        max_cost = state.get("max_cost_usd")
        return json.dumps({
            "turns_used": turns_used,
            "turns_remaining": (max_turns - turns_used) if max_turns else None,
            "tokens_used": tokens_used,
            "tokens_remaining": (max_tokens - tokens_used) if max_tokens else None,
            "cost_used_usd": cost_used,
            "cost_remaining_usd": (max_cost - cost_used) if max_cost else None,
            "exhausted": (
                (max_turns is not None and turns_used >= max_turns)
                or (max_tokens is not None and tokens_used >= max_tokens)
                or (max_cost is not None and cost_used >= max_cost)
            ),
        }, indent=2)

    return [self_status, self_tools, self_history, self_budget]


def register_introspection_tools(registry, state_provider: Callable[[], dict[str, Any]]) -> None:
    """Register introspection tools into ``registry``."""
    for fn in make_introspection_tools(state_provider):
        register_all(registry, fn)
