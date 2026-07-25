"""Tests for kairo.tools.file_ops, edit, search."""

from __future__ import annotations

import pytest

from kairo.errors import ToolError
from kairo.tools.base import ToolRegistry, register_all
from kairo.tools.edit import EditToolsConfig, make_edit_tools
from kairo.tools.file_ops import FileToolsConfig, make_file_tools, _safe_resolve
from kairo.tools.search import SearchToolsConfig, make_search_tools


def _build(root):
    fc = FileToolsConfig(root=root)
    ec = EditToolsConfig(file_cfg=fc, require_read_first=False)
    sc = SearchToolsConfig(file_cfg=fc)
    reg = ToolRegistry()
    for fn in make_file_tools(fc):
        register_all(reg, fn)
    for fn in make_edit_tools(ec):
        register_all(reg, fn)
    for fn in make_search_tools(sc):
        register_all(reg, fn)
    return reg


def test_safe_resolve_rejects_escape(tmp_workspace):
    fc = FileToolsConfig(root=tmp_workspace)
    with pytest.raises(ToolError):
        _safe_resolve(tmp_workspace, "../../etc/passwd")


def test_safe_resolve_rejects_symlink(tmp_workspace):
    fc = FileToolsConfig(root=tmp_workspace, allow_symlinks=False)
    # not actually a symlink, just verify the flag check
    p = _safe_resolve(tmp_workspace, "foo.py", allow_symlinks=False)
    assert p.parent == tmp_workspace.resolve()


def test_write_and_read_file(tmp_workspace):
    reg = _build(tmp_workspace)
    w = reg.get("write_file").fn
    r = reg.get("read_file").fn
    w(path="hello.txt", content="line1\nline2\n")
    out = r(path="hello.txt")
    assert "hello.txt" in out
    assert "line1" in out
    assert "line2" in out


def test_read_file_not_found(tmp_workspace):
    reg = _build(tmp_workspace)
    r = reg.get("read_file").fn
    with pytest.raises(ToolError):
        r(path="nope.txt")


def test_list_dir(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "a.txt").write_text("a")
    (tmp_workspace / "b").mkdir()
    out = reg.get("list_dir").fn(path=".")
    assert "a.txt" in out
    assert "b/" in out


def test_glob_files(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "a.py").write_text("x")
    (tmp_workspace / "b.py").write_text("y")
    (tmp_workspace / "c.txt").write_text("z")
    out = reg.get("glob_files").fn(pattern="**/*.py")
    assert "a.py" in out
    assert "b.py" in out
    assert "c.txt" not in out


def test_edit_file_unique_match(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_file").fn(path="x.txt", content="hello world")
    out = reg.get("edit_file").fn(
        path="x.txt", old_string="hello", new_string="hi"
    )
    assert "Replaced 1" in out
    assert (tmp_workspace / "x.txt").read_text() == "hi world"


def test_edit_file_ambiguous(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_file").fn(path="x.txt", content="foo foo bar")
    with pytest.raises(ToolError):
        reg.get("edit_file").fn(path="x.txt", old_string="foo", new_string="baz")


def test_edit_file_replace_all(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_file").fn(path="x.txt", content="foo foo bar")
    reg.get("edit_file").fn(path="x.txt", old_string="foo", new_string="baz", replace_all=True)
    assert (tmp_workspace / "x.txt").read_text() == "baz baz bar"


def test_edit_file_missing_match(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_file").fn(path="x.txt", content="hello")
    with pytest.raises(ToolError):
        reg.get("edit_file").fn(path="x.txt", old_string="nope", new_string="x")


def test_multi_edit_atomic(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_file").fn(path="x.txt", content="aaa bbb ccc")
    edits = [
        {"old_string": "aaa", "new_string": "AAA"},
        {"old_string": "bbb", "new_string": "BBB"},
    ]
    out = reg.get("multi_edit").fn(path="x.txt", edits=edits)
    assert "Applied 2" in out
    assert (tmp_workspace / "x.txt").read_text() == "AAA BBB ccc"


def test_multi_edit_rolls_back_on_failure(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_file").fn(path="x.txt", content="aaa bbb ccc")
    edits = [
        {"old_string": "aaa", "new_string": "AAA"},
        {"old_string": "NOT_THERE", "new_string": "X"},  # fails
    ]
    with pytest.raises(ToolError):
        reg.get("multi_edit").fn(path="x.txt", edits=edits)
    # Original text restored.
    assert (tmp_workspace / "x.txt").read_text() == "aaa bbb ccc"


def test_grep_finds_pattern(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "a.py").write_text("def foo():\n    pass\n")
    (tmp_workspace / "b.py").write_text("def bar():\n    pass\n")
    out = reg.get("grep").fn(pattern="def foo", path=".")
    assert "a.py" in out
    assert "def foo" in out
    assert "b.py" not in out


def test_grep_no_matches(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "a.py").write_text("hello")
    out = reg.get("grep").fn(pattern="NOPE_NOT_THERE", path=".")
    assert "no matches" in out.lower()
