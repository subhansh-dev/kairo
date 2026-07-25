"""Kairo exception hierarchy.

All Kairo exceptions descend from :class:`KairoError` so callers can catch
the entire family with a single ``except``. More specific subclasses make
it easy to distinguish provider failures from tool failures from safety
trips without parsing strings.
"""

from __future__ import annotations

from typing import Any


class KairoError(Exception):
    """Base class for every Kairo exception."""


class ConfigError(KairoError):
    """Raised when configuration is missing or invalid."""


class ProviderError(KairoError):
    """A provider backend failed to fulfil a request."""

    def __init__(self, provider: str, message: str, *, status: int | None = None,
                 payload: Any | None = None) -> None:
        super().__init__(f"[{provider}] {message}")
        self.provider = provider
        self.status = status
        self.payload = payload


class ProviderUnavailable(ProviderError):
    """The provider exists but cannot be reached / has no API key configured."""


class RateLimitError(ProviderError):
    """Upstream returned a rate-limit response."""


class ToolError(KairoError):
    """A tool invocation failed at runtime (non-zero exit, bad args, etc.)."""

    def __init__(self, tool: str, message: str, *, payload: Any | None = None) -> None:
        super().__init__(f"[tool:{tool}] {message}")
        self.tool = tool
        self.payload = payload


class ToolArgumentError(ToolError):
    """A tool was called with arguments that failed schema validation."""


class ToolNotFoundError(ToolError):
    """The model requested a tool that is not registered."""


class GuardrailError(KairoError):
    """A guardrail tripped and aborted the call.

    Guardrails are *non-fatal by design* — the agent loop converts them
    into structured ``ToolResult`` error messages so the model can recover
    on the next turn instead of crashing.
    """

    def __init__(self, rule: str, message: str, *, severity: str = "block") -> None:
        super().__init__(f"[guardrail:{rule}] {message}")
        self.rule = rule
        self.severity = severity


class BudgetExceeded(KairoError):
    """The agent exceeded its token / cost / iteration budget."""


class LoopLimitExceeded(KairoError):
    """The agent hit its iteration cap before finishing."""


class ContextWindowExceeded(KairoError):
    """The conversation no longer fits in any available provider."""


class RouterError(KairoError):
    """The router could not pick any model for the request."""


class OrchestratorError(KairoError):
    """An orchestrator phase (planner / executor / critic) failed."""


class ParseError(KairoError):
    """The model produced output that could not be parsed into tool calls."""
