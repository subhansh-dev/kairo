"""Tests for kairo.tools.web_design — HTML/CSS tools."""

from __future__ import annotations

import pytest

from kairo.errors import ToolError
from kairo.tools.base import ToolRegistry, register_all
from kairo.tools.file_ops import FileToolsConfig
from kairo.tools.web_design import WebDesignToolsConfig, make_web_design_tools


def _build(root):
    fc = FileToolsConfig(root=root)
    wc = WebDesignToolsConfig(file_cfg=fc, use_browser=False)
    reg = ToolRegistry()
    for fn in make_web_design_tools(wc):
        register_all(reg, fn)
    return reg


def test_write_html_no_boilerplate(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_html").fn(path="index.html", content="<p>hi</p>")
    assert (tmp_workspace / "index.html").read_text() == "<p>hi</p>"


def test_write_html_with_boilerplate(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_html").fn(
        path="index.html",
        content="<h1>Hello</h1>",
        wrap_boilerplate=True,
        title="Test Page",
    )
    text = (tmp_workspace / "index.html").read_text()
    assert text.startswith("<!DOCTYPE html>")
    assert "<title>Test Page</title>" in text
    assert "<h1>Hello</h1>" in text


def test_write_css(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_css").fn(path="styles.css", content="body { color: red; }")
    assert "color: red" in (tmp_workspace / "styles.css").read_text()


def test_validate_html_well_formed(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_html").fn(
        path="index.html",
        content="<!DOCTYPE html><html><head></head><body><p>hi</p></body></html>",
    )
    out = reg.get("validate_html").fn(path="index.html")
    assert "OK" in out


def test_validate_html_missing_doctype(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_html").fn(
        path="index.html",
        content="<html><body><p>hi</p></body></html>",
    )
    out = reg.get("validate_html").fn(path="index.html")
    assert "DOCTYPE" in out


def test_validate_html_unbalanced_tags(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_html").fn(
        path="index.html",
        content="<!DOCTYPE html><html><head></head><body><p>hi</body></html>",
    )
    out = reg.get("validate_html").fn(path="index.html")
    assert "unclosed" in out.lower() or "unbalanced" in out.lower()


def test_extract_outline(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("write_html").fn(
        path="index.html",
        content=(
            "<html><body>"
            "<h1>Title</h1>"
            "<h2>Sub</h2>"
            "<section><h3>Deep</h3></section>"
            "<img alt='pic' src='x.png'>"
            "</body></html>"
        ),
    )
    out = reg.get("extract_outline").fn(path="index.html")
    assert "H1: Title" in out
    assert "H2: Sub" in out
    assert "H3: Deep" in out
    assert "IMG: pic" in out


def test_preview_html_falls_back_to_outline(tmp_workspace):
    # use_browser=False forces outline fallback.
    reg = _build(tmp_workspace)
    reg.get("write_html").fn(
        path="index.html",
        content="<html><body><h1>Hello</h1></body></html>",
    )
    out = reg.get("preview_html").fn(path="index.html")
    assert "H1: Hello" in out


def test_preview_html_file_not_found(tmp_workspace):
    reg = _build(tmp_workspace)
    with pytest.raises(ToolError):
        reg.get("preview_html").fn(path="nope.html")


def test_start_and_stop_dev_server(tmp_workspace):
    reg = _build(tmp_workspace)
    (tmp_workspace / "index.html").write_text("<h1>hi</h1>")
    # Pick a high port to avoid conflicts.
    out = reg.get("start_dev_server").fn(port=18923)
    assert "http://127.0.0.1:18923/" in out
    # Verify it serves.
    import urllib.request
    resp = urllib.request.urlopen("http://127.0.0.1:18923/index.html", timeout=3)
    body = resp.read().decode()
    assert "<h1>hi</h1>" in body
    # Stop it.
    out2 = reg.get("stop_dev_server").fn(port=18923)
    assert "stopped" in out2.lower()


def test_dev_server_already_running_returns_message(tmp_workspace):
    reg = _build(tmp_workspace)
    reg.get("start_dev_server").fn(port=18924)
    out = reg.get("start_dev_server").fn(port=18924)
    assert "already running" in out
    reg.get("stop_dev_server").fn(port=18924)
