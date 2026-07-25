"""Tests for kairo.tools.base — registry + schema inference."""

from __future__ import annotations

import pytest

from kairo.errors import ToolNotFoundError
from kairo.tools.base import ToolRegistry, register_all, tool, _infer_schema


def test_infer_schema_basic():
    def f(a: str, b: int = 0, c: list | None = None) -> str:
        return ""
    s = _infer_schema(f)
    assert s["properties"]["a"]["type"] == "string"
    assert s["properties"]["b"]["type"] == "integer"
    assert "a" in s["required"]
    assert "b" not in s["required"]


def test_infer_schema_no_annotation_defaults_to_string():
    def f(x):
        return x
    s = _infer_schema(f)
    assert s["properties"]["x"]["type"] == "string"


def test_registry_register_and_get():
    reg = ToolRegistry()

    @tool(name="echo")
    def echo(text: str) -> str:
        """Echo back."""
        return text

    register_all(reg, echo)
    assert reg.has("echo")
    rt = reg.get("echo")
    assert rt.spec.name == "echo"
    assert "Echo back" in rt.spec.description


def test_registry_unknown_raises():
    reg = ToolRegistry()
    with pytest.raises(ToolNotFoundError):
        reg.get("nope")


def test_registry_specs_filter():
    reg = ToolRegistry()

    @tool(name="a")
    def a(x: str) -> str:
        return x

    @tool(name="b")
    def b(x: str) -> str:
        return x

    register_all(reg, a, b)
    specs = reg.specs(names=["a"])
    assert [s.name for s in specs] == ["a"]


def test_registry_async_detection():
    reg = ToolRegistry()

    @tool(name="async_thing")
    async def async_thing(x: str) -> str:
        return x

    register_all(reg, async_thing)
    rt = reg.get("async_thing")
    assert rt.is_async is True
