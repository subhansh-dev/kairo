"""Tests for kairo.tools.plugins — dynamic tool discovery + plugin loading."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.tools.base import ToolRegistry, register_all, tool
from kairo.tools.plugins import PluginManager, make_discovery_tool


def _write_plugin(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / f"{name}.py"
    p.write_text(content)
    return p


def test_plugin_manager_load_one_with_tool_decorator(tmp_path: Path):
    """Plugin with @tool-decorated functions gets auto-registered."""
    plugin = _write_plugin(tmp_path, "myplugin", """
from kairo.tools.base import tool

@tool(name="custom_greet")
def greet(name: str) -> str:
    '''Greet someone.'''
    return f"Hello {name}!"
""")
    mgr = PluginManager()
    reg = ToolRegistry()
    info = mgr.load_one(plugin, reg)
    assert info.error is None
    assert "custom_greet" in info.tools_registered
    assert reg.has("custom_greet")
    # The tool should actually work.
    rt = reg.get("custom_greet")
    assert rt.fn(name="World") == "Hello World!"


def test_plugin_manager_load_one_with_register_function(tmp_path: Path):
    """Plugin with a register(registry) function gets called."""
    plugin = _write_plugin(tmp_path, "regplugin", """
from kairo.tools.base import tool

@tool(name="registered_tool")
def my_tool(x: str) -> str:
    '''Does something.'''
    return x

def register(registry):
    # Custom registration logic could go here.
    pass
""")
    mgr = PluginManager()
    reg = ToolRegistry()
    info = mgr.load_one(plugin, reg)
    assert info.error is None
    # The @tool-decorated function should be auto-registered.
    assert "registered_tool" in info.tools_registered


def test_plugin_manager_load_all(tmp_path: Path):
    _write_plugin(tmp_path, "a", """
from kairo.tools.base import tool

@tool(name="tool_a")
def a() -> str:
    '''A tool.'''
    return "a"
""")
    _write_plugin(tmp_path, "b", """
from kairo.tools.base import tool

@tool(name="tool_b")
def b() -> str:
    '''B tool.'''
    return "b"
""")
    # Non-.py file should be ignored.
    (tmp_path / "not_python.txt").write_text("ignore me")
    mgr = PluginManager(plugins_dir=tmp_path)
    reg = ToolRegistry()
    infos = mgr.load_all(reg)
    assert len(infos) == 2
    assert reg.has("tool_a")
    assert reg.has("tool_b")


def test_plugin_manager_unload(tmp_path: Path):
    plugin = _write_plugin(tmp_path, "x", """
from kairo.tools.base import tool

@tool(name="tool_x")
def x() -> str:
    '''X.'''
    return "x"
""")
    mgr = PluginManager()
    reg = ToolRegistry()
    mgr.load_one(plugin, reg)
    assert reg.has("tool_x")
    assert mgr.is_loaded("x")
    assert mgr.unload("x", reg) is True
    assert not reg.has("tool_x")
    assert not mgr.is_loaded("x")
    # Unload again returns False.
    assert mgr.unload("x", reg) is False


def test_plugin_manager_list_loaded(tmp_path: Path):
    plugin = _write_plugin(tmp_path, "y", """
from kairo.tools.base import tool

@tool(name="tool_y")
def y() -> str:
    '''Y.'''
    return "y"
""")
    mgr = PluginManager()
    reg = ToolRegistry()
    mgr.load_one(plugin, reg)
    loaded = mgr.list_loaded()
    assert len(loaded) == 1
    assert loaded[0].name == "y"


def test_plugin_manager_discover_empty_dir(tmp_path: Path):
    mgr = PluginManager(plugins_dir=tmp_path)
    assert mgr.discover() == []


def test_plugin_manager_discover_no_dir():
    mgr = PluginManager(plugins_dir=None)
    assert mgr.discover() == []


def test_plugin_manager_load_one_missing_file(tmp_path: Path):
    mgr = PluginManager()
    reg = ToolRegistry()
    with pytest.raises(Exception):
        mgr.load_one(tmp_path / "nonexistent.py", reg)


def test_plugin_manager_load_one_with_syntax_error(tmp_path: Path):
    plugin = _write_plugin(tmp_path, "bad", "def broken(:\n  pass\n")
    mgr = PluginManager()
    reg = ToolRegistry()
    info = mgr.load_one(plugin, reg)
    assert info.error is not None
    assert "syntax" in info.error.lower() or "syntaxerror" in info.error.lower()


def test_discovery_tool_loads_plugin(tmp_path: Path):
    _write_plugin(tmp_path, "p", """
from kairo.tools.base import tool

@tool(name="discovered_tool")
def dt() -> str:
    '''Discovered.'''
    return "found"
""")
    mgr = PluginManager(plugins_dir=tmp_path)
    reg = ToolRegistry()
    discover = make_discovery_tool(mgr, reg)
    # Register the discover tool itself.
    register_all(reg, discover)
    # Call it — should load the plugin.
    out = reg.get("discover_tools").fn()
    assert "p" in out
    assert "discovered_tool" in out
    # The discovered tool should now be registered.
    assert reg.has("discovered_tool")


def test_discovery_tool_with_specific_path(tmp_path: Path):
    plugin = _write_plugin(tmp_path, "specific", """
from kairo.tools.base import tool

@tool(name="specific_tool")
def st() -> str:
    '''Specific.'''
    return "yes"
""")
    mgr = PluginManager()
    reg = ToolRegistry()
    discover = make_discovery_tool(mgr, reg)
    register_all(reg, discover)
    out = reg.get("discover_tools").fn(path=str(plugin))
    assert "specific" in out
    assert "specific_tool" in out
    assert reg.has("specific_tool")


def test_discovery_tool_no_plugins(tmp_path: Path):
    mgr = PluginManager(plugins_dir=tmp_path)
    reg = ToolRegistry()
    discover = make_discovery_tool(mgr, reg)
    register_all(reg, discover)
    out = reg.get("discover_tools").fn()
    assert "no plugins" in out.lower()
