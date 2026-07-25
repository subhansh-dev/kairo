"""Tests for kairo.tools.shell + kairo.tools.web + kairo.tools.todo."""

from __future__ import annotations

import pytest

from kairo.errors import ToolError
from kairo.tools.base import ToolRegistry, register_all
from kairo.tools.file_ops import FileToolsConfig
from kairo.tools.shell import ShellToolsConfig, make_shell_tools
from kairo.tools.todo import TodoStore, make_todo_tools
from kairo.tools.web import WebToolsConfig, make_web_tools


def _shell_registry(root):
    fc = FileToolsConfig(root=root)
    sc = ShellToolsConfig(file_cfg=fc, timeout_s=10.0)
    reg = ToolRegistry()
    for fn in make_shell_tools(sc):
        register_all(reg, fn)
    return reg


def test_shell_echo(tmp_workspace):
    reg = _shell_registry(tmp_workspace)
    out = reg.get("shell").fn(command="echo hello")
    assert "hello" in out
    assert "[exit 0]" in out


def test_shell_blocked_substring(tmp_workspace):
    reg = _shell_registry(tmp_workspace)
    with pytest.raises(ToolError):
        reg.get("shell").fn(command="rm -rf /")


def test_shell_timeout(tmp_workspace):
    reg = _shell_registry(tmp_workspace)
    with pytest.raises(ToolError):
        reg.get("shell").fn(command="sleep 5", timeout=0.5)


def test_shell_captures_stderr(tmp_workspace):
    reg = _shell_registry(tmp_workspace)
    out = reg.get("shell").fn(command="echo oops >&2")
    assert "oops" in out
    assert "stderr" in out.lower()


def test_run_python_executes(tmp_workspace):
    reg = _shell_registry(tmp_workspace)
    out = reg.get("run_python").fn(code="print(2 + 2)")
    assert "4" in out


def test_run_python_captures_traceback(tmp_workspace):
    reg = _shell_registry(tmp_workspace)
    out = reg.get("run_python").fn(code="raise ValueError('boom')")
    assert "boom" in out
    assert "ValueError" in out


def test_run_python_empty_code_errors(tmp_workspace):
    reg = _shell_registry(tmp_workspace)
    with pytest.raises(ToolError):
        reg.get("run_python").fn(code="")


# ---------------------------------------------------------------------------
# Web tools
# ---------------------------------------------------------------------------

def test_web_fetch_rejects_non_http():
    reg = ToolRegistry()
    for fn in make_web_tools(WebToolsConfig()):
        register_all(reg, fn)
    with pytest.raises(ToolError):
        reg.get("web_fetch").fn(url="file:///etc/passwd")


def test_web_search_no_backend_errors():
    reg = ToolRegistry()
    for fn in make_web_tools(WebToolsConfig()):
        register_all(reg, fn)
    with pytest.raises(ToolError):
        reg.get("web_search").fn(query="anything")


def test_web_search_with_backend():
    calls = []

    def backend(q, n):
        calls.append((q, n))
        return [{"title": "T", "url": "http://x", "snippet": "S"}]

    reg = ToolRegistry()
    for fn in make_web_tools(WebToolsConfig(search_backend=backend)):
        register_all(reg, fn)
    out = reg.get("web_search").fn(query="hi", max_results=3)
    assert "T" in out
    assert "http://x" in out
    assert calls == [("hi", 3)]


# ---------------------------------------------------------------------------
# Todo tools
# ---------------------------------------------------------------------------

def test_todo_set_and_list():
    store = TodoStore()
    reg = ToolRegistry()
    for fn in make_todo_tools(store):
        register_all(reg, fn)
    out = reg.get("todo_set").fn(items=[
        {"id": "t1", "content": "first"},
        {"id": "t2", "content": "second"},
    ])
    assert "t1" in out
    assert "t2" in out
    assert store.items[0].state.value == "pending"


def test_todo_update_changes_state():
    store = TodoStore()
    reg = ToolRegistry()
    for fn in make_todo_tools(store):
        register_all(reg, fn)
    reg.get("todo_set").fn(items=[{"id": "t1", "content": "x"}])
    out = reg.get("todo_update").fn(item_id="t1", state="completed")
    assert "[x]" in out
    assert store.items[0].state.value == "completed"


def test_todo_update_invalid_state_errors():
    store = TodoStore()
    reg = ToolRegistry()
    for fn in make_todo_tools(store):
        register_all(reg, fn)
    reg.get("todo_set").fn(items=[{"id": "t1", "content": "x"}])
    with pytest.raises(ToolError):
        reg.get("todo_update").fn(item_id="t1", state="bogus")


def test_todo_update_unknown_id_errors():
    store = TodoStore()
    reg = ToolRegistry()
    for fn in make_todo_tools(store):
        register_all(reg, fn)
    with pytest.raises(ToolError):
        reg.get("todo_update").fn(item_id="nope", state="completed")
