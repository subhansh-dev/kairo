"""Tests for kairo.agent.code_sandbox — constrained Python interpreter."""

from __future__ import annotations

import pytest

from kairo.agent.code_sandbox import CodeSandbox
from kairo.tools.base import ToolRegistry, register_all, tool


def _make_registry():
    reg = ToolRegistry()

    @tool(name="add")
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    @tool(name="greet")
    def greet(name: str) -> str:
        """Greet someone."""
        return f"Hello, {name}!"

    register_all(reg, add, greet)
    return reg


def test_sandbox_runs_simple_expression():
    sb = CodeSandbox(_make_registry())
    result = sb.run("1 + 1")
    assert result.error is None
    assert result.result == 2


def test_sandbox_calls_registered_tool():
    sb = CodeSandbox(_make_registry())
    result = sb.run("add(2, 3)")
    assert result.error is None
    assert result.result == 5


def test_sandbox_calls_string_tool():
    sb = CodeSandbox(_make_registry())
    result = sb.run('greet(name="World")')
    assert result.error is None
    assert "Hello, World!" in str(result.result)


def test_sandbox_multi_statement():
    sb = CodeSandbox(_make_registry())
    result = sb.run("x = add(1, 2)\ny = add(x, 3)\ny")
    assert result.error is None
    assert result.result == 6


def test_sandbox_captures_stdout():
    sb = CodeSandbox(_make_registry())
    result = sb.run('print(add(2, 3))')
    assert result.error is None
    assert "5" in result.stdout


def test_sandbox_blocks_import():
    sb = CodeSandbox(_make_registry())
    result = sb.run("import os")
    assert result.error is not None
    assert "forbidden" in result.error.lower()


def test_sandbox_blocks_dunder_access():
    sb = CodeSandbox(_make_registry())
    result = sb.run("add.__globals__")
    assert result.error is not None
    assert "forbidden" in result.error.lower()


def test_sandbox_blocks_exec():
    sb = CodeSandbox(_make_registry())
    result = sb.run('exec("print(1)")')
    assert result.error is not None


def test_sandbox_blocks_open():
    sb = CodeSandbox(_make_registry())
    result = sb.run('open("/etc/passwd")')
    assert result.error is not None


def test_sandbox_uses_control_flow():
    sb = CodeSandbox(_make_registry())
    code = """
total = 0
for i in range(5):
    total = add(total, i)
total
"""
    result = sb.run(code)
    assert result.error is None
    # 0 + 1 + 2 + 3 + 4 = 10
    assert result.result == 10


def test_sandbox_returns_error_on_exception():
    sb = CodeSandbox(_make_registry())
    result = sb.run("1 / 0")
    assert result.error is not None
    # Even though ZeroDivisionError is the cause, the message should mention it.
    assert "ZeroDivisionError" in result.error or "division" in result.error.lower()


def test_sandbox_unknown_name_errors():
    sb = CodeSandbox(_make_registry())
    result = sb.run("unknown_function(1)")
    assert result.error is not None
    assert "NameError" in result.error or "unknown_function" in result.error
