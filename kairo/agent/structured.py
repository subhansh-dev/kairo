"""Structured output — force model responses into a JSON schema.

Real-world edge-model problem: small local models emit broken JSON ~20%
of the time. This module provides:

  * :func:`parse_json_lenient` — multiple fallbacks (json.loads →
    ast.literal_eval → regex extract → repair quotes).
  * :func:`validate_against_schema` — check a dict against a JSON Schema
    subset, with helpful error messages.
  * :func:`coerce_to_schema` — best-effort type coercion (string→int,
    missing fields filled with defaults, extra fields dropped).
  * :class:`StructuredRunner` — wraps any provider to return validated
    objects. Failed parses trigger a single repair call to the model
    showing the error.

For real constrained decoding (grammar-based), use vLLM with xgrammar
or outlines — Kairo's structured runner is a prompt+parse layer that
works against any provider including tiny local models.
"""

from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass, field
from typing import Any, Type

from kairo.errors import KairoError, ParseError
from kairo.types import Message, ProviderResponse, Role
from kairo.utils import get_logger

log = get_logger("structured")


# ---------------------------------------------------------------------------
# Lenient JSON parsing
# ---------------------------------------------------------------------------

def parse_json_lenient(text: str) -> Any:
    """Parse JSON with multiple fallbacks.

    Tries in order:
      1. ``json.loads(text)``
      2. Extract from markdown code fences
      3. Extract first ``{...}`` or ``[...]`` block
      4. ``ast.literal_eval`` for Python-literal "JSON"
      5. Repair single-quoted strings to double-quoted and retry
    """
    if not text or not text.strip():
        raise ParseError("empty input")

    text = text.strip()
    # 1. Direct parse.
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Markdown fence.
    fenced = _extract_fenced(text)
    if fenced is not None:
        try:
            return json.loads(fenced)
        except json.JSONDecodeError:
            pass

    # 3. First {...} or [...] block.
    block = _extract_block(text)
    if block is not None:
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            pass

    # 4. ast.literal_eval (Python literals).
    try:
        return ast.literal_eval(text)
    except (SyntaxError, ValueError):
        pass

    # 5. Quote repair: ' → ".
    repaired = _repair_quotes(text)
    if repaired != text:
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            pass

    raise ParseError(f"could not parse JSON from: {text[:200]!r}")


def _extract_fenced(text: str) -> str | None:
    m = re.search(r"```(?:json)?\s*\n(.*?)\n```", text, re.DOTALL)
    return m.group(1).strip() if m else None


def _extract_block(text: str) -> str | None:
    # Find first balanced { ... } or [ ... ].
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        if start < 0:
            continue
        depth = 0
        for i in range(start, len(text)):
            c = text[i]
            if c == opener:
                depth += 1
            elif c == closer:
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
    return None


def _repair_quotes(text: str) -> str:
    """Replace single-quoted strings with double-quoted JSON-compatible ones."""
    # Replace '...' with "..." — naive but works for most model output.
    return re.sub(r"'([^']*)'", r'"\1"', text)


# ---------------------------------------------------------------------------
# Schema validation (JSON-Schema subset)
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ValidationError:
    path: str
    message: str


def validate_against_schema(value: Any, schema: dict) -> list[ValidationError]:
    """Validate ``value`` against a JSON Schema subset.

    Supports: type, properties, required, items, enum, minimum, maximum,
    minLength, maxLength. Returns a list of errors (empty = valid).
    """
    errors: list[ValidationError] = []
    _validate(value, schema, "$", errors)
    return errors


def _validate(value: Any, schema: dict, path: str, errors: list[ValidationError]) -> None:
    if "type" in schema:
        if not _matches_type(value, schema["type"]):
            errors.append(ValidationError(
                path=path,
                message=f"expected type {schema['type']!r}, got {type(value).__name__}",
            ))
            return
    if "enum" in schema and value not in schema["enum"]:
        errors.append(ValidationError(
            path=path, message=f"value {value!r} not in enum {schema['enum']!r}",
        ))
    if schema.get("type") == "object" and isinstance(value, dict):
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in value:
                errors.append(ValidationError(
                    path=f"{path}.{req}", message=f"missing required property",
                ))
        for k, v in value.items():
            if k in props:
                _validate(v, props[k], f"{path}.{k}", errors)
    if schema.get("type") == "array" and isinstance(value, list):
        item_schema = schema.get("items")
        if item_schema:
            for i, item in enumerate(value):
                _validate(item, item_schema, f"{path}[{i}]", errors)
    if schema.get("type") == "string" and isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(ValidationError(path=path, message=f"string too short"))
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(ValidationError(path=path, message=f"string too long"))
    if schema.get("type") in ("integer", "number") and isinstance(value, (int, float)):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(ValidationError(path=path, message=f"value below minimum"))
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(ValidationError(path=path, message=f"value above maximum"))


def _matches_type(value: Any, t: str) -> bool:
    if t == "string":
        return isinstance(value, str)
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "boolean":
        return isinstance(value, bool)
    if t == "array":
        return isinstance(value, list)
    if t == "object":
        return isinstance(value, dict)
    if t == "null":
        return value is None
    return True


# ---------------------------------------------------------------------------
# Coercion
# ---------------------------------------------------------------------------

def coerce_to_schema(value: Any, schema: dict) -> Any:
    """Best-effort coercion of ``value`` to match ``schema``.

    Handles: type casts (str→int, etc.), filling missing required fields
    with type-defaults, dropping extra fields.
    """
    if "type" not in schema:
        return value
    t = schema["type"]
    if t == "string" and not isinstance(value, str):
        return str(value) if value is not None else ""
    if t == "integer" and not isinstance(value, int):
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0
    if t == "number" and not isinstance(value, (int, float)):
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
    if t == "boolean" and not isinstance(value, bool):
        return bool(value)
    if t == "array":
        if not isinstance(value, list):
            return [coerce_to_schema(value, schema.get("items", {}))] if value is not None else []
        item_schema = schema.get("items", {})
        return [coerce_to_schema(v, item_schema) for v in value]
    if t == "object":
        if not isinstance(value, dict):
            return {}
        props = schema.get("properties", {})
        out: dict[str, Any] = {}
        for k, v in value.items():
            if k in props:
                out[k] = coerce_to_schema(v, props[k])
        # Fill required fields with defaults.
        for req in schema.get("required", []):
            if req not in out:
                out[req] = _default_for_schema(props.get(req, {}))
        return out
    return value


def _default_for_schema(schema: dict) -> Any:
    t = schema.get("type")
    if t == "string":
        return ""
    if t == "integer":
        return 0
    if t == "number":
        return 0.0
    if t == "boolean":
        return False
    if t == "array":
        return []
    if t == "object":
        return {}
    if t == "null":
        return None
    return None


# ---------------------------------------------------------------------------
# StructuredRunner — wraps a provider to return validated objects
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class StructuredResult:
    """Validated structured response."""

    value: Any
    raw_text: str
    errors: list[ValidationError] = field(default_factory=list)
    repaired: bool = False
    attempts: int = 1


class StructuredRunner:
    """Wraps a provider to return schema-validated structured output.

    Usage::

        runner = StructuredRunner(provider, model="glm-4.6")
        schema = {"type": "object", "properties": {
            "name": {"type": "string"},
            "age": {"type": "integer"},
        }, "required": ["name"]}
        result = runner.complete(messages, schema=schema)
        # result.value is a validated dict.
    """

    def __init__(self, provider, *, model: str, max_repair_attempts: int = 1) -> None:
        self.provider = provider
        self.model = model
        self.max_repair_attempts = max_repair_attempts

    def complete(
        self,
        messages: list[Message],
        *,
        schema: dict,
        schema_name: str = "response",
        temperature: float = 0.0,
        max_tokens: int | None = None,
    ) -> StructuredResult:
        """Call the provider and parse the response into a validated object."""
        sys_prompt = (
            f"You are a structured-output assistant. Respond with a single "
            f"JSON object that conforms to this schema:\n\n"
            f"{json.dumps(schema, indent=2)}\n\n"
            f"Respond with ONLY the JSON object. No prose, no markdown fences, "
            f"no comments — just the JSON."
        )
        request_messages = [Message(role=Role.SYSTEM, content=sys_prompt), *messages]
        attempts = 0
        last_errors: list[ValidationError] = []
        last_text = ""
        for attempt in range(self.max_repair_attempts + 1):
            attempts = attempt + 1
            if attempt > 0 and last_errors:
                # Repair call: show the errors and ask for a fixed response.
                err_str = "\n".join(f"- {e.path}: {e.message}" for e in last_errors)
                request_messages.append(Message(
                    role=Role.USER,
                    content=(
                        f"Your previous response had these validation errors:\n{err_str}\n\n"
                        f"Please respond again with a corrected JSON object."
                    ),
                ))
            resp = self.provider.complete(
                messages=request_messages,
                tools=None,
                model=self.model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            last_text = resp.content.strip()
            try:
                value = parse_json_lenient(last_text)
            except ParseError as exc:
                last_errors = [ValidationError(path="$", message=str(exc))]
                continue
            # Coerce + validate.
            value = coerce_to_schema(value, schema)
            errors = validate_against_schema(value, schema)
            if not errors:
                return StructuredResult(
                    value=value, raw_text=last_text, errors=[], repaired=attempt > 0,
                    attempts=attempts,
                )
            last_errors = errors
        # Couldn't repair — return last attempt with errors.
        return StructuredResult(
            value=value if 'value' in dir() else None,
            raw_text=last_text, errors=last_errors, repaired=attempts > 1,
            attempts=attempts,
        )
