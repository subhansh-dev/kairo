"""Core domain types for Kairo.

These dataclasses are intentionally framework-agnostic — they do not depend
on any provider SDK so that providers can translate to/from their own
shapes (OpenAI tool_calls, Anthropic content blocks, Hermes XML, etc.)
without leaking SDK types into the rest of the codebase.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, Mapping


class Role(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass(slots=True)
class ToolCall:
    """A single tool call requested by the model.

    ``id`` is generated locally so we can correlate calls with results
    even when the upstream provider does not return ids (e.g. Hermes XML).
    """

    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: f"call_{uuid.uuid4().hex[:12]}")
    # Optional provider-side id (OpenAI returns one; Hermes does not).
    provider_id: str | None = None
    # Free-form metadata for the agent loop (attempt count, etc.).
    meta: dict[str, Any] = field(default_factory=dict)

    def fingerprint(self) -> str:
        """Stable identity used for de-duplication by the spam guard.

        Two calls with the same name + same arguments share a fingerprint,
        regardless of their ``id``. This is what lets the guardrail detect
        "the model asked the exact same thing 3 turns in a row".
        """
        import json
        canonical = json.dumps(self.arguments, sort_keys=True, default=str)
        return f"{self.name}:{canonical}"


@dataclass(slots=True)
class ToolResult:
    """Result returned by a tool, fed back to the model."""

    call_id: str
    name: str
    ok: bool
    content: Any
    error: str | None = None
    # Wall-clock seconds the tool took.
    duration_s: float = 0.0
    # Tokens consumed by this tool result if known (for budget tracking).
    tokens: int | None = None

    def to_message_payload(self) -> dict[str, Any]:
        """Convert into the dict shape used inside Message.tool_results."""
        return {
            "call_id": self.call_id,
            "name": self.name,
            "ok": self.ok,
            "content": self.content,
            "error": self.error,
        }


@dataclass(slots=True)
class Message:
    """A single chat message in Kairo's provider-agnostic format.

    Notes:
      * ``tool_calls`` is populated only when ``role == ASSISTANT``.
      * ``tool_result`` is populated only when ``role == TOOL`` and
        references the :class:`ToolCall.id` it answers.
      * ``meta`` carries optional diagnostics (provider, model, latency).
    """

    role: Role
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_result: ToolResult | None = None
    name: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    # Wall-clock timestamp (epoch seconds) — used by memory compaction.
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"role": self.role.value, "content": self.content}
        if self.tool_calls:
            d["tool_calls"] = [
                {"id": tc.id, "name": tc.name, "arguments": tc.arguments}
                for tc in self.tool_calls
            ]
        if self.tool_result is not None:
            d["tool_result"] = self.tool_result.to_message_payload()
        if self.name:
            d["name"] = self.name
        return d


ProviderName = Literal["openai", "anthropic", "openrouter", "ollama", "glm", "hermes_xml"]


@dataclass(slots=True)
class ModelInfo:
    """Static-ish metadata about a model, used by the router."""

    name: str
    provider: ProviderName
    # Context window in tokens.
    context: int
    # Approximate $/1M input tokens.
    cost_in_per_m: float
    # Approximate $/1M output tokens.
    cost_out_per_m: float
    # Rough tokens/sec observed in practice (0 = unknown).
    tps: float = 0.0
    # Capability tags the router matches against.
    capabilities: tuple[str, ...] = ()
    # Whether this model supports parallel tool calls in a single turn.
    parallel_tools: bool = True
    # Whether this model natively supports tool/function calling.
    native_tools: bool = True


@dataclass(slots=True)
class ProviderResponse:
    """What a provider returns to the agent loop."""

    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    # Provider-reported usage (may be None for local models).
    usage: dict[str, int] | None = None
    model: str | None = None
    finish_reason: str | None = None
    # Wall-clock seconds for the API call.
    latency_s: float = 0.0
    # Raw provider response for debugging — never serialized into the loop.
    raw: Any | None = None

    @property
    def is_tool_turn(self) -> bool:
        return bool(self.tool_calls)


@dataclass(slots=True)
class AgentTurn:
    """A single iteration of the agent loop.

    Captured for replay/inspection so we can run post-hoc analysis on a
    finished session (which tools ran, how long, what the model said).
    """

    index: int
    request_messages: list[Message]
    response: ProviderResponse
    tool_results: list[ToolResult] = field(default_factory=list)
    started_at: float = 0.0
    ended_at: float = 0.0
    model: str | None = None
    provider: ProviderName | None = None
    router_reason: str | None = None

    @property
    def duration_s(self) -> float:
        return max(0.0, self.ended_at - self.started_at)


@dataclass(slots=True)
class AgentResult:
    """Final outcome of a full agent run."""

    messages: list[Message]
    turns: list[AgentTurn]
    finish_reason: str  # "complete" | "loop_limit" | "budget" | "error" | "cancelled"
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    total_duration_s: float = 0.0
    error: str | None = None


class TaskKind(str, Enum):
    """Coarse task classification used by the router.

    The router maps a TaskKind to a preferred model. TaskKind is detected
    heuristically from the latest user/tool message — e.g. a request to
    "write tests" maps to :attr:`TESTS`, a request to "summarize" maps to
    :attr:`SUMMARY`, etc.
    """

    PLAN = "plan"
    CODE = "code"
    CODE_REVIEW = "code_review"
    REFACTOR = "refactor"
    TESTS = "tests"
    DEBUG = "debug"
    EXPLAIN = "explain"
    SUMMARY = "summary"
    SEARCH = "search"
    SHELL = "shell"
    GENERAL = "general"


@dataclass(slots=True)
class RoutingDecision:
    """A router verdict: which model + why."""

    model: ModelInfo
    reason: str
    # Tag-style hints the orchestrator may consume.
    tags: tuple[str, ...] = ()


@dataclass(slots=True)
class ToolSpec:
    """JSON-Schema-style tool description fed to providers."""

    name: str
    description: str
    parameters: dict[str, Any]
    # Optional: hard cap on how many times this tool may be called per run.
    max_calls_per_run: int | None = None
    # Optional: hard cap on how many times this tool may be called per turn.
    max_calls_per_turn: int | None = None
    # Tags for filtering — e.g. {"dangerous"} lets the safety layer
    # require explicit confirmation.
    tags: tuple[str, ...] = ()


@dataclass(slots=True)
class Budget:
    """Resource budget for an agent run.

    Any field set to ``None`` means "unlimited". When *any* field is
    exhausted the agent loop stops with ``finish_reason == "budget"``.
    """

    max_turns: int | None = None
    max_tokens: int | None = None
    max_cost_usd: float | None = None
    max_wall_s: float | None = None
    # Per-tool call counter, populated at runtime.
    tool_calls: dict[str, int] = field(default_factory=dict)

    def can_call(self, name: str, cap: int | None) -> bool:
        if cap is None:
            return True
        return self.tool_calls.get(name, 0) < cap

    def record_call(self, name: str) -> None:
        self.tool_calls[name] = self.tool_calls.get(name, 0) + 1


def as_role(v: Role | str) -> Role:
    if isinstance(v, Role):
        return v
    return Role(v)


def merge_meta(*metas: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for m in metas:
        if m:
            out.update(m)
    return out
