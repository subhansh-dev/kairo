"""Safety layer — prompt-injection filter + dangerous-tool confirmation.

This is intentionally a thin layer. The hard caps (loop limits, token
budgets, spam guards) live in the agent loop and the SpamGuard. This
module handles:
  * Detecting obvious prompt-injection patterns in tool outputs before
    they reach the model.
  * Requiring confirmation for tools tagged ``dangerous`` when
    interactive_confirm is on.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from kairo.config import SafetyConfig
from kairo.errors import GuardrailError
from kairo.types import ToolCall, ToolResult
from kairo.utils import get_logger

log = get_logger("agent.safety")


# Patterns that suggest a tool output is trying to manipulate the model.
# Conservative — we only block the most blatant cases.
_INJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.I),
    re.compile(r"you\s+are\s+now\s+(?:a|an)\s+", re.I),
    re.compile(r"system\s*prompt\s*:", re.I),
    re.compile(r"<\|im_start\|>", re.I),
    re.compile(r"<\|assistant\|>", re.I),
    re.compile(r"reveal\s+(your|the)\s+(system|hidden|secret)\s+prompt", re.I),
    re.compile(r"disregard\s+(the\s+)?above", re.I),
]


@dataclass(slots=True)
class SafetyFilter:
    cfg: SafetyConfig
    # Optional callable invoked when a dangerous tool is about to run.
    # Returns True to proceed, False to abort.
    confirmer: Callable[[ToolCall], bool] | None = None

    def check_tool_output(self, result: ToolResult) -> GuardrailError | None:
        """Scan a tool result for injection patterns. Mutates result in-place
        to redact if found."""
        if not self.cfg.enable_injection_filter:
            return None
        text = _stringify(result.content)
        for pat in _INJECTION_PATTERNS:
            m = pat.search(text)
            if m:
                snippet = text[max(0, m.start() - 40): m.end() + 40]
                log.warning("injection pattern %r in tool %s output: ...%s...",
                            pat.pattern, result.name, snippet)
                # Redact the offending text rather than dropping the whole result.
                redacted = pat.sub("[REDACTED-INJECTION]", text)
                result.content = redacted
                return GuardrailError(
                    "injection_filter",
                    f"redacted suspected prompt-injection in {result.name} output",
                    severity="warn",
                )
        return None

    def confirm_dangerous(self, call: ToolCall, tags: tuple[str, ...]) -> GuardrailError | None:
        """Return a GuardrailError if the call should be blocked."""
        if not self.cfg.enable_dangerous_confirm:
            return None
        if "dangerous" not in tags:
            return None
        if self.confirmer is None:
            # Non-interactive: allow but log.
            log.info("dangerous tool %s called without confirmer; allowing", call.name)
            return None
        try:
            ok = self.confirmer(call)
        except Exception as exc:  # noqa: BLE001
            return GuardrailError("confirm_failed", f"confirmer raised: {exc}")
        if not ok:
            return GuardrailError(
                "user_denied",
                f"User denied dangerous tool call {call.name}",
            )
        return None


def _stringify(v) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    try:
        import json
        return json.dumps(v, default=str)
    except (TypeError, ValueError):
        return str(v)
