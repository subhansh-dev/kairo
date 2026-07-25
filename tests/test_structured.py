"""Tests for kairo.agent.structured — JSON parsing + schema validation."""

from __future__ import annotations

import pytest

from kairo.agent.structured import (
    ValidationError,
    coerce_to_schema,
    parse_json_lenient,
    validate_against_schema,
)
from kairo.errors import ParseError


# ---------------------------------------------------------------------------
# parse_json_lenient
# ---------------------------------------------------------------------------

def test_parse_json_direct():
    assert parse_json_lenient('{"a": 1}') == {"a": 1}
    assert parse_json_lenient("[1, 2, 3]") == [1, 2, 3]


def test_parse_json_with_whitespace():
    assert parse_json_lenient('  {"a": 1}  ') == {"a": 1}


def test_parse_json_markdown_fenced():
    text = '```json\n{"a": 1}\n```'
    assert parse_json_lenient(text) == {"a": 1}


def test_parse_json_plain_fenced():
    text = '```\n{"a": 1}\n```'
    assert parse_json_lenient(text) == {"a": 1}


def test_parse_json_extract_block():
    text = 'Here is the answer:\n{"a": 1, "b": 2}\nThat is it.'
    assert parse_json_lenient(text) == {"a": 1, "b": 2}


def test_parse_json_python_literal():
    text = "{'a': 1, 'b': 2}"  # single-quoted — invalid JSON
    assert parse_json_lenient(text) == {"a": 1, "b": 2}


def test_parse_json_empty_raises():
    with pytest.raises(ParseError):
        parse_json_lenient("")


def test_parse_json_garbage_raises():
    with pytest.raises(ParseError):
        parse_json_lenient("not json at all")


def test_parse_json_array_extract():
    text = 'Result: [1, 2, 3] done.'
    assert parse_json_lenient(text) == [1, 2, 3]


# ---------------------------------------------------------------------------
# validate_against_schema
# ---------------------------------------------------------------------------

def test_validate_simple_object_valid():
    schema = {
        "type": "object",
        "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
        "required": ["name"],
    }
    errors = validate_against_schema({"name": "Alice", "age": 30}, schema)
    assert errors == []


def test_validate_missing_required():
    schema = {
        "type": "object",
        "properties": {"name": {"type": "string"}},
        "required": ["name"],
    }
    errors = validate_against_schema({}, schema)
    assert len(errors) == 1
    assert "missing required" in errors[0].message


def test_validate_wrong_type():
    schema = {"type": "string"}
    errors = validate_against_schema(42, schema)
    assert len(errors) == 1
    assert "expected type 'string'" in errors[0].message


def test_validate_nested_object():
    schema = {
        "type": "object",
        "properties": {
            "user": {
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            }
        },
    }
    errors = validate_against_schema({"user": {}}, schema)
    assert any("missing required" in e.message for e in errors)


def test_validate_array_items():
    schema = {
        "type": "array",
        "items": {"type": "integer"},
    }
    errors = validate_against_schema([1, 2, "three"], schema)
    assert any("[2]" in e.path for e in errors)


def test_validate_enum():
    schema = {"type": "string", "enum": ["red", "green", "blue"]}
    errors = validate_against_schema("yellow", schema)
    assert len(errors) == 1


def test_validate_min_max():
    schema = {"type": "integer", "minimum": 0, "maximum": 100}
    assert validate_against_schema(50, schema) == []
    assert len(validate_against_schema(-1, schema)) == 1
    assert len(validate_against_schema(101, schema)) == 1


def test_validate_string_length():
    schema = {"type": "string", "minLength": 3, "maxLength": 5}
    assert validate_against_schema("hi!", schema) == []
    assert len(validate_against_schema("hi", schema)) == 1
    assert len(validate_against_schema("hello!", schema)) == 1


# ---------------------------------------------------------------------------
# coerce_to_schema
# ---------------------------------------------------------------------------

def test_coerce_string_to_int():
    schema = {"type": "integer"}
    assert coerce_to_schema("42", schema) == 42


def test_coerce_string_to_float():
    schema = {"type": "number"}
    assert coerce_to_schema("3.14", schema) == 3.14


def test_coerce_int_to_string():
    schema = {"type": "string"}
    assert coerce_to_schema(42, schema) == "42"


def test_coerce_object_fills_required_defaults():
    schema = {
        "type": "object",
        "properties": {"name": {"type": "string"}, "count": {"type": "integer"}},
        "required": ["name", "count"],
    }
    out = coerce_to_schema({}, schema)
    assert out == {"name": "", "count": 0}


def test_coerce_object_drops_unknown_fields():
    schema = {
        "type": "object",
        "properties": {"a": {"type": "string"}},
    }
    out = coerce_to_schema({"a": "x", "b": "y"}, schema)
    assert "a" in out
    assert "b" not in out


def test_coerce_array():
    schema = {"type": "array", "items": {"type": "integer"}}
    out = coerce_to_schema(["1", "2", "3"], schema)
    assert out == [1, 2, 3]


def test_coerce_boolean_truthy():
    schema = {"type": "boolean"}
    assert coerce_to_schema("yes", schema) is True
    assert coerce_to_schema("", schema) is False
