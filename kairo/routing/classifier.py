"""Task classifier — heuristics that map a conversation onto a TaskKind.

The router uses TaskKind to pick a model: planning tasks go to a strong
reasoner, code tasks go to a coding-tuned model, summarization goes to
the cheapest capable model, etc. This is intentionally a fast regex
heuristic — no LLM call, no latency.
"""

from __future__ import annotations

import re

from kairo.types import Message, Role, TaskKind


# Keyword sets per task kind. Matched case-insensitive against the last
# user/tool message. Order matters — earlier kinds win on ties.
_RULES: list[tuple[TaskKind, list[re.Pattern[str]]]] = [
    (TaskKind.PLAN, [
        re.compile(r"\b(plan|planning|roadmap|strategy|outline|decompose|todo)\b", re.I),
        re.compile(r"\b(step\s*\d|first.*then|break.*down|sequenc)\b", re.I),
    ]),
    (TaskKind.CODE_REVIEW, [
        re.compile(r"\b(review|critique|spot.*bug|smell|lint|anti-?pattern)\b", re.I),
        re.compile(r"\b(what.*wrong|why.*fail|find.*issue)\b", re.I),
    ]),
    (TaskKind.TESTS, [
        re.compile(r"\b(test|tests|testing|pytest|unittest|fixture|mock)\b", re.I),
        re.compile(r"\b(coverage|edge case|property-based|fuzz)\b", re.I),
    ]),
    (TaskKind.DEBUG, [
        re.compile(r"\b(debug|traceback|stack trace|exception|error|crash)\b", re.I),
        re.compile(r"\b(why.*throw|fix.*error|root cause)\b", re.I),
    ]),
    (TaskKind.REFACTOR, [
        re.compile(r"\b(refactor|extract.*method|rename|deduplicate|DRY|cleanup)\b", re.I),
        re.compile(r"\b(restructure|reorganize|simplify.*without)\b", re.I),
    ]),
    (TaskKind.SEARCH, [
        re.compile(r"\b(search|grep|find.*file|where.*defined|locate)\b", re.I),
        re.compile(r"\b(who.*calls|references|imports of)\b", re.I),
    ]),
    (TaskKind.SHELL, [
        re.compile(r"\b(shell|run|execute|command|bash|subprocess)\b", re.I),
        re.compile(r"\b(install|pip install|npm install|cargo build)\b", re.I),
    ]),
    (TaskKind.EXPLAIN, [
        re.compile(r"\b(explain|what.*does|how.*work|describe|walk.*through)\b", re.I),
        re.compile(r"\b(why.*like this|tell me about)\b", re.I),
    ]),
    (TaskKind.SUMMARY, [
        re.compile(r"\b(summarize|summary|tl;?dr|condense|brief)\b", re.I),
        re.compile(r"\b(recap|overview of|high-level)\b", re.I),
    ]),
    (TaskKind.CODE, [
        re.compile(r"\b(code|function|class|method|implement|write.*python|write.*js)\b", re.I),
        re.compile(r"\b(api|endpoint|handler|component|module)\b", re.I),
    ]),
]


def classify_task(messages: list[Message]) -> TaskKind:
    """Pick a TaskKind based on the last user / tool message.

    Falls back to :attr:`TaskKind.GENERAL` when nothing matches.
    """
    if not messages:
        return TaskKind.GENERAL
    target: Message | None = None
    for m in reversed(messages):
        if m.role in (Role.USER, Role.TOOL):
            target = m
            break
    if target is None:
        return TaskKind.GENERAL
    text = (target.content or "")
    if target.tool_result is not None:
        text += " " + str(target.tool_result.content or "")
    if not text.strip():
        return TaskKind.GENERAL

    scores: dict[TaskKind, int] = {}
    for kind, patterns in _RULES:
        score = sum(1 for p in patterns if p.search(text))
        if score > 0:
            scores[kind] = score
    if not scores:
        return TaskKind.GENERAL
    # Pick highest score; ties broken by the _RULES order above.
    best = max(scores.items(), key=lambda kv: kv[1])[0]
    return best
