"""Tests for kairo.tools.swe — AST-based code intelligence."""

from __future__ import annotations

import pytest

from kairo.tools.base import ToolRegistry, register_all
from kairo.tools.file_ops import FileToolsConfig
from kairo.tools.swe import SWEToolsConfig, make_swe_tools


def _build(root):
    fc = FileToolsConfig(root=root)
    sc = SWEToolsConfig(file_cfg=fc)
    reg = ToolRegistry()
    for fn in make_swe_tools(sc):
        register_all(reg, fn)
    return reg


def test_get_imports_parses_python(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "foo.py").write_text(
        "import os\n"
        "from pathlib import Path\n"
        "import json as J\n"
        "\n"
        "def f(): pass\n"
    )
    out = reg.get("get_imports").fn(path="foo.py")
    import json
    data = json.loads(out)
    names = {d["name"] for d in data}
    assert "os" in names
    assert "Path" in names
    assert "J" in names


def test_get_imports_non_python_returns_empty(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "foo.txt").write_text("import os")
    out = reg.get("get_imports").fn(path="foo.txt")
    assert out == "[]"


def test_get_imports_syntax_error_raises(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "bad.py").write_text("def f(:\n  pass")
    with pytest.raises(Exception):
        reg.get("get_imports").fn(path="bad.py")


def test_get_signature_extracts_function(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "foo.py").write_text(
        "def add(a: int, b: int = 0) -> int:\n"
        "    return a + b\n"
        "\n"
        "class Foo:\n"
        "    def method(self, x):\n"
        "        return x\n"
    )
    import json
    out = reg.get("get_signature").fn(path="foo.py")
    data = json.loads(out)
    by_name = {d["name"]: d for d in data}
    assert "add" in by_name
    assert "a: int" in by_name["add"]["args"]
    assert "Foo" in by_name
    assert "method" in by_name["Foo"]["methods"]


def test_get_signature_filter_by_symbol(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "foo.py").write_text(
        "def a(): pass\n"
        "def b(): pass\n"
    )
    import json
    out = reg.get("get_signature").fn(path="foo.py", symbol="b")
    data = json.loads(out)
    assert len(data) == 1
    assert data[0]["name"] == "b"


def test_get_importers_finds_importers(tmp_workspace):
    reg = _build(tmp_workspace)
    # foo.py defines stuff, bar.py imports foo, baz.py imports os.
    (tmp_workspace / "foo.py").write_text("X = 1\n")
    (tmp_workspace / "bar.py").write_text("import foo\nfoo.X\n")
    (tmp_workspace / "baz.py").write_text("import os\n")
    out = reg.get("get_importers").fn(module="foo")
    assert "bar.py" in out
    assert "baz.py" not in out


def test_get_importers_no_match(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "foo.py").write_text("import os\n")
    out = reg.get("get_importers").fn(module="nonexistent_module")
    assert "no importers" in out.lower()


def test_find_references(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "a.py").write_text("def foo(): pass\nfoo()\n")
    (tmp_workspace / "b.py").write_text("from a import foo\nfoo()\n")
    out = reg.get("find_references").fn(symbol="foo")
    assert "a.py" in out
    assert "b.py" in out


def test_get_call_graph(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "foo.py").write_text(
        "def a():\n"
        "    b()\n"
        "    print(1)\n"
        "def b():\n"
        "    c()\n"
        "def c():\n"
        "    pass\n"
    )
    import json
    out = reg.get("get_call_graph").fn()
    data = json.loads(out)
    names = {n["name"] for n in data["nodes"]}
    assert {"a", "b", "c"}.issubset(names)
    callers = {e["caller"] for e in data["edges"]}
    assert any("::a" in c for c in callers)
    assert any("::b" in c for c in callers)
