"""Content moderation guardrails — block unsafe content in + out.

Production agents need to refuse unsafe requests and avoid emitting
unsafe outputs. This module provides a configurable moderation layer
that runs *before* the agent sees user input and *after* the agent
produces output.

Two filter types:
  * :class:`InputFilter` — runs on user messages. Can block the input
    entirely, redact sensitive parts, or just log it.
  * :class:`OutputFilter` — runs on assistant messages. Can block the
    output (returning a refusal instead), redact, or log.

Each filter has a list of :class:`ModerationRule` objects. Built-in
rules:
  * :class:`PIIRedactor` — redacts emails, phone numbers, SSNs, credit
    card numbers, API keys.
  * :class:`SecretRedactor` — redacts known secret patterns (AWS keys,
    GitHub PATs, JWT tokens).
  * :class:`ProfanityFilter` — replaces profanity with asterisks.
  * :class:`TopicBlocker` — blocks requests about specified topics
    (e.g. "how to hack", "build a weapon").
  * :class:`PromptInjectionBlocker` — detects common prompt-injection
    patterns ("ignore previous instructions", "you are now...").

Custom rules can be added by subclassing :class:`ModerationRule`.

All filters are deterministic (no LLM calls) so they're fast and
predictable. For richer semantic moderation, plug in a separate
moderation model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from kairo.errors import GuardrailError
from kairo.utils import get_logger

log = get_logger("agent.moderation")


class ModerationAction(str, Enum):
    ALLOW = "allow"          # pass through unchanged
    REDACT = "redact"        # replace sensitive parts with [REDACTED]
    BLOCK = "block"          # replace entire message with a refusal
    LOG = "log"              # log but pass through unchanged


@dataclass(slots=True)
class ModerationResult:
    """Outcome of a moderation pass."""

    action: ModerationAction
    text: str  # the (possibly redacted) text
    rules_triggered: list[str] = field(default_factory=list)
    reason: str | None = None


class ModerationRule:
    """Base class for moderation rules. Subclasses implement ``check``."""

    name: str = "rule"

    def check(self, text: str) -> ModerationResult:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Built-in rules
# ---------------------------------------------------------------------------

class PIIRedactor(ModerationRule):
    """Redact common PII patterns."""

    name = "pii_redactor"

    PATTERNS: list[tuple[str, re.Pattern]] = [
        ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")),
        # SSN before phone so 123-45-6789 doesn't match the phone regex first.
        ("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
        ("phone", re.compile(r"\b\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b")),
        ("credit_card", re.compile(r"\b(?:\d[ -]*?){13,16}\b")),
        ("ipv4", re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")),
    ]

    def check(self, text: str) -> ModerationResult:
        out = text
        triggered: list[str] = []
        for kind, pat in self.PATTERNS:
            if pat.search(out):
                out = pat.sub(f"[REDACTED-{kind.upper()}]", out)
                triggered.append(kind)
        if triggered:
            return ModerationResult(
                action=ModerationAction.REDACT, text=out,
                rules_triggered=triggered,
                reason=f"redacted PII: {', '.join(triggered)}",
            )
        return ModerationResult(action=ModerationAction.ALLOW, text=text)


class SecretRedactor(ModerationRule):
    """Redact known secret patterns (API keys, JWTs, etc.)."""

    name = "secret_redactor"

    PATTERNS: list[tuple[str, re.Pattern]] = [
        # AWS access key
        ("aws_access", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
        # AWS secret
        ("aws_secret", re.compile(r"\baws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}\b",
                                  re.IGNORECASE)),
        # GitHub PAT (classic + fine-grained)
        ("github_pat", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b")),
        # Generic API key patterns
        ("api_key", re.compile(r"\b(?:api[_-]?key|apikey|secret[_-]?key)\s*[=:]\s*[A-Za-z0-9_\-]{20,}\b",
                                re.IGNORECASE)),
        # JWT (header.payload.signature)
        ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")),
        # Slack token
        ("slack", re.compile(r"\bxox[bpras]-[A-Za-z0-9-]+\b")),
    ]

    def check(self, text: str) -> ModerationResult:
        out = text
        triggered: list[str] = []
        for kind, pat in self.PATTERNS:
            if pat.search(out):
                out = pat.sub(f"[REDACTED-{kind.upper()}]", out)
                triggered.append(kind)
        if triggered:
            return ModerationResult(
                action=ModerationAction.REDACT, text=out,
                rules_triggered=triggered,
                reason=f"redacted secrets: {', '.join(triggered)}",
            )
        return ModerationResult(action=ModerationAction.ALLOW, text=text)


class ProfanityFilter(ModerationRule):
    """Replace common profanity with asterisks."""

    name = "profanity"

    WORDS = {"fuck", "shit", "bitch", "asshole", "bastard", "damn", "crap"}

    def check(self, text: str) -> ModerationResult:
        out = text
        triggered = False
        for word in self.WORDS:
            pat = re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE)
            if pat.search(out):
                out = pat.sub("*" * len(word), out)
                triggered = True
        if triggered:
            return ModerationResult(
                action=ModerationAction.REDACT, text=out,
                rules_triggered=["profanity"],
                reason="redacted profanity",
            )
        return ModerationResult(action=ModerationAction.ALLOW, text=text)


class TopicBlocker(ModerationRule):
    """Block requests about specified topics."""

    name = "topic_blocker"

    def __init__(self, blocked_phrases: list[str]) -> None:
        self.blocked_phrases = [p.lower() for p in blocked_phrases]

    def check(self, text: str) -> ModerationResult:
        text_lower = text.lower()
        for phrase in self.blocked_phrases:
            if phrase in text_lower:
                return ModerationResult(
                    action=ModerationAction.BLOCK,
                    text="(blocked: this request touches a forbidden topic)",
                    rules_triggered=["topic_blocker"],
                    reason=f"matched blocked phrase: {phrase!r}",
                )
        return ModerationResult(action=ModerationAction.ALLOW, text=text)


class PromptInjectionBlocker(ModerationRule):
    """Detect common prompt-injection patterns."""

    name = "prompt_injection_blocker"

    PATTERNS = [
        re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.I),
        re.compile(r"disregard\s+(the\s+)?above", re.I),
        re.compile(r"you\s+are\s+now\s+(?:a|an)\s+", re.I),
        re.compile(r"reveal\s+(your|the)\s+(system|hidden|secret)\s+prompt", re.I),
        re.compile(r"<\|im_start\|>", re.I),
        re.compile(r"<\|assistant\|>", re.I),
        re.compile(r"system\s*prompt\s*:", re.I),
    ]

    def check(self, text: str) -> ModerationResult:
        for pat in self.PATTERNS:
            if pat.search(text):
                return ModerationResult(
                    action=ModerationAction.BLOCK,
                    text="(blocked: suspected prompt injection)",
                    rules_triggered=["prompt_injection"],
                    reason=f"matched injection pattern: {pat.pattern!r}",
                )
        return ModerationResult(action=ModerationAction.ALLOW, text=text)


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

class InputFilter:
    """Runs moderation rules on user input."""

    def __init__(self, rules: list[ModerationRule] | None = None) -> None:
        self.rules: list[ModerationRule] = rules or [
            PromptInjectionBlocker(),
            PIIRedactor(),
            SecretRedactor(),
        ]

    def check(self, text: str) -> ModerationResult:
        out = text
        all_triggered: list[str] = []
        for rule in self.rules:
            result = rule.check(out)
            out = result.text
            all_triggered.extend(result.rules_triggered)
            if result.action == ModerationAction.BLOCK:
                return ModerationResult(
                    action=ModerationAction.BLOCK,
                    text=result.text,
                    rules_triggered=all_triggered,
                    reason=result.reason,
                )
        if all_triggered:
            return ModerationResult(
                action=ModerationAction.REDACT, text=out,
                rules_triggered=all_triggered,
                reason=f"redacted by: {', '.join(set(all_triggered))}",
            )
        return ModerationResult(action=ModerationAction.ALLOW, text=text)


class OutputFilter:
    """Runs moderation rules on assistant output."""

    def __init__(self, rules: list[ModerationRule] | None = None) -> None:
        self.rules: list[ModerationRule] = rules or [
            PIIRedactor(),
            SecretRedactor(),
        ]

    def check(self, text: str) -> ModerationResult:
        out = text
        all_triggered: list[str] = []
        for rule in self.rules:
            result = rule.check(out)
            out = result.text
            all_triggered.extend(result.rules_triggered)
            if result.action == ModerationAction.BLOCK:
                return ModerationResult(
                    action=ModerationAction.BLOCK,
                    text="(refused: output failed moderation)",
                    rules_triggered=all_triggered,
                    reason=result.reason,
                )
        if all_triggered:
            return ModerationResult(
                action=ModerationAction.REDACT, text=out,
                rules_triggered=all_triggered,
                reason=f"redacted by: {', '.join(set(all_triggered))}",
            )
        return ModerationResult(action=ModerationAction.ALLOW, text=text)
