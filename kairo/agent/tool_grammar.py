"""Tool-call grammar — force tiny-model tool calls into valid shape.

Small local models (1-8B params) often emit *almost*-valid tool calls:
  * Missing closing brace
  * Single-quoted "JSON"
  * Tool name and arguments on separate lines
  * Trailing commas
  * Embedded prose around the JSON

This module provides a "grammar" layer that takes raw model output and
produces a list of validated :class:`ToolCall` objects. It's a
prompt-side + parse-side alternative to true constrained decoding
(which requires grammar-aware inference engines like vLLM + xgrammar).

Layers (applied in order):
  1. Extract candidate tool-call blocks from the text (XML tags,
     markdown fences, bare JSON).
  2. Parse each block with :func:`parse_json_lenient` (5 fallbacks).
  3. Validate the parsed object against the tool registry's schema.
  4. Auto-repair common issues: missing ``arguments`` key, wrong
     arg types, extra fields.
  5. Return the list of validated :class:`ToolCall` objects.

If repair fails, the original parse error is returned so the agent
loop can feed it back to the model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from kairo.agent.structured import coerce_to_schema, parse_json_lenient, validate_against_schema
from kairo.errors import ParseError
from kairo.tools.base import ToolRegistry
from kairo.types import ToolCall
from kairo.utils import get_logger

log = get_logger("agent.tool_grammar")


# Markers that small models use to delimit tool calls.
_BLOCK_PATTERNS = [
    # <tool_call>{...}</tool_call>
    re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL),
    # ```json\n{...}\n```
    re.compile(r"```(?:json)?\s*\n(.*?)\n```", re.DOTALL),
    # <function_call>{...}</function_call>
    re.compile(r"<function_call>\s*(.*?)\s*</function_call>", re.DOTALL),
    # [TOOL_CALL] {...}
    re.compile(r"\[TOOL_CALL\]\s*(\{.*?\})", re.DOTALL),
]


@dataclass(slots=True)
class GrammarResult:
    """Outcome of grammar-based tool-call extraction."""

    calls: list[ToolCall]
    # Calls that couldn't be repaired — caller feeds these back to the model.
    errors: list[str]


def extract_tool_calls_grammar(
    text: str,
    registry: ToolRegistry,
) -> GrammarResult:
    """Extract + validate tool calls from raw model text.

    This is the small-model-friendly extractor. It tries multiple block
    formats, parses leniently, and validates against the registry.
    """
    if not text or not text.strip():
        return GrammarResult(calls=[], errors=[])

    blocks: list[str] = []
    # 1. Try every block pattern.
    for pat in _BLOCK_PATTERNS:
        for m in pat.finditer(text):
            blocks.append(m.group(1).strip())
    # 2. If no blocks found, try to find bare {...} that look like tool calls.
    if not blocks:
        for m in re.finditer(r'\{[^{}]*"name"\s*:\s*"[^"]+"[^{}]*\}', text, re.DOTALL):
            blocks.append(m.group(0))
    # 3. Last resort: try the whole text.
    if not blocks and ("name" in text and "arguments" in text or "name" in text):
        blocks.append(text.strip())

    calls: list[ToolCall] = []
    errors: list[str] = []
    for block in blocks:
        try:
            data = parse_json_lenient(block)
        except ParseError as exc:
            errors.append(f"could not parse block: {exc}")
            continue
        # The data could be a single dict or a list of dicts.
        if isinstance(data, dict):
            data = [data]
        if not isinstance(data, list):
            errors.append(f"parsed block was not dict/list: {type(data).__name__}")
            continue
        for item in data:
            if not isinstance(item, dict):
                continue
            call = _coerce_to_tool_call(item, registry, errors)
            if call is not None:
                calls.append(call)
    return GrammarResult(calls=calls, errors=errors)


def _coerce_to_tool_call(
    item: dict,
    registry: ToolRegistry,
    errors: list[str],
) -> ToolCall | None:
    """Coerce a parsed dict into a validated ToolCall.

    Handles common small-model mistakes:
      * Missing ``arguments`` key (defaults to {})
      * ``args`` instead of ``arguments``
      * Tool name in ``function`` instead of ``name``
      * Arguments as a string instead of a dict
    """
    # Resolve tool name. Try several common shapes.
    fn_field = item.get("function")
    if isinstance(fn_field, dict):
        # OpenAI-style: {"function": {"name": ..., "arguments": ...}}
        name = fn_field.get("name", "")
        args = fn_field.get("arguments", {})
    else:
        name = (
            item.get("name")
            or item.get("tool")
            or (fn_field if isinstance(fn_field, str) else "")
            or ""
        )
        # Resolve arguments.
        args = (
            item.get("arguments")
            or item.get("args")
            or item.get("parameters")
            or {}
        )

    if not name:
        errors.append(f"missing tool name in: {item}")
        return None

    if isinstance(args, str):
        try:
            args = parse_json_lenient(args)
        except ParseError:
            args = {"_raw": args}
    if not isinstance(args, dict):
        args = {"_value": args}

    # Validate against the registry if we know this tool.
    if registry.has(name):
        spec = registry.get(name)
        args = coerce_to_schema(args, spec.spec.parameters)
        errs = validate_against_schema(args, spec.spec.parameters)
        if errs:
            for e in errs:
                errors.append(f"{name}.{e.path}: {e.message}")
            # Still return the call — the agent loop can show the error
            # to the model and let it retry.
    else:
        errors.append(f"unknown tool: {name!r}")

    return ToolCall(name=name, arguments=args)


# ---------------------------------------------------------------------------
# Tool-call formatter — render tool specs in a tiny-model-friendly format
# ---------------------------------------------------------------------------

def render_tools_compact(registry: ToolRegistry) -> str:
    """Render the tool list in a compact format optimized for small models.

    Smaller than the OpenAI tools schema (saves tokens) and easier for
    small models to parse. Format::

        TOOLS:
        - read_file(path: str, offset: int=0): Read a file from disk.
        - write_file(path: str, content: str): Write a file.
        ...

    Use this in the system prompt for XML tool-call providers when the
    model is small (≤8B) and every token counts.
    """
    lines = ["TOOLS:"]
    for spec in registry.specs():
        # Render parameters compactly.
        params = spec.parameters.get("properties", {})
        required = set(spec.parameters.get("required", []))
        param_strs = []
        for pname, pschema in params.items():
            ptype = pschema.get("type", "any")
            if pname in required:
                param_strs.append(f"{pname}: {ptype}")
            else:
                param_strs.append(f"{pname}: {ptype}=...")
        # Truncate description to first sentence.
        desc = spec.description.split(".")[0].strip()[:120]
        lines.append(f"- {spec.name}({', '.join(param_strs)}): {desc}")
    return "\n".join(lines)


def render_tool_call_example(name: str, arguments: dict) -> str:
    """Render a single tool call in the XML format small models should emit.

    Useful for few-shot prompting.
    """
    import json
    obj = {"name": name, "arguments": arguments}
    return f"<tool_call>\n{json.dumps(obj)}\n</tool_call>"
