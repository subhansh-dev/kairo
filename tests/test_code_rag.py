"""Tests for kairo.tools.code_rag — TF-IDF code search."""

from __future__ import annotations

import pytest

from kairo.tools.base import ToolRegistry, register_all
from kairo.tools.code_rag import CodeRagConfig, CodeRagIndex, make_code_rag_tools
from kairo.tools.file_ops import FileToolsConfig


def _build(root):
    fc = FileToolsConfig(root=root)
    rc = CodeRagConfig(file_cfg=fc)
    reg = ToolRegistry()
    for fn in make_code_rag_tools(rc):
        register_all(reg, fn)
    return reg, rc


def test_index_build_empty_workspace(tmp_workspace):
    fc = FileToolsConfig(root=tmp_workspace)
    rc = CodeRagConfig(file_cfg=fc)
    idx = CodeRagIndex(rc)
    n = idx.build()
    assert n == 0
    assert idx.search("anything") == []


def test_index_build_with_files(tmp_workspace):
    (tmp_workspace / "auth.py").write_text(
        "def login(user, password):\n"
        "    return authenticate(user, password)\n"
    )
    (tmp_workspace / "billing.py").write_text(
        "def charge(customer, amount):\n"
        "    return process_payment(customer, amount)\n"
    )
    fc = FileToolsConfig(root=tmp_workspace)
    rc = CodeRagConfig(file_cfg=fc)
    idx = CodeRagIndex(rc)
    n = idx.build()
    assert n == 2


def test_search_returns_relevant_file(tmp_workspace):
    (tmp_workspace / "auth.py").write_text(
        "def login(user, password):\n"
        "    return authenticate(user, password)\n"
    )
    (tmp_workspace / "billing.py").write_text(
        "def charge(customer, amount):\n"
        "    return process_payment(customer, amount)\n"
    )
    fc = FileToolsConfig(root=tmp_workspace)
    rc = CodeRagConfig(file_cfg=fc)
    idx = CodeRagIndex(rc)
    idx.build()
    results = idx.search("authenticate user login", limit=2)
    assert len(results) >= 1
    # The auth file should rank first.
    assert "auth.py" in results[0].rel_path
    assert "authenticate" in results[0].snippet.lower() or "login" in results[0].snippet.lower()


def test_search_no_match_returns_empty(tmp_workspace):
    (tmp_workspace / "auth.py").write_text("def login(): pass\n")
    fc = FileToolsConfig(root=tmp_workspace)
    rc = CodeRagConfig(file_cfg=fc)
    idx = CodeRagIndex(rc)
    idx.build()
    results = idx.search("cooking pasta recipes")
    assert results == []


def test_code_search_tool(tmp_workspace):
    (tmp_workspace / "auth.py").write_text(
        "def authenticate(user, password):\n"
        "    return check_credentials(user, password)\n"
    )
    reg, _ = _build(tmp_workspace)
    # First call triggers build.
    out = reg.get("code_search").fn(query="authenticate user", limit=3)
    assert "auth.py" in out
    assert "authenticate" in out


def test_code_search_rebuild_tool(tmp_workspace):
    (tmp_workspace / "a.py").write_text("x = 1\n")
    reg, _ = _build(tmp_workspace)
    out = reg.get("code_search_rebuild").fn()
    assert "Indexed 1" in out


def test_code_search_stats_tool(tmp_workspace):
    (tmp_workspace / "a.py").write_text("x = 1\n")
    reg, _ = _build(tmp_workspace)
    # Trigger build first.
    reg.get("code_search").fn(query="x", limit=1)
    out = reg.get("code_search_stats").fn()
    import json
    stats = json.loads(out)
    assert stats["file_count"] == 1
    assert stats["built"] is True


def test_index_skips_large_files(tmp_workspace):
    big = "x" * (200 * 1024)  # 200KB, over the default 64KB cap
    (tmp_workspace / "big.py").write_text(big)
    (tmp_workspace / "small.py").write_text("y = 1\n")
    fc = FileToolsConfig(root=tmp_workspace)
    rc = CodeRagConfig(file_cfg=fc)
    idx = CodeRagIndex(rc)
    n = idx.build()
    assert n == 1  # only small.py


def test_index_skips_hidden_and_pycache(tmp_workspace):
    (tmp_workspace / ".hidden.py").write_text("x = 1\n")
    (tmp_workspace / "__pycache__" / "mod.py").parent.mkdir(parents=True)
    (tmp_workspace / "__pycache__" / "mod.py").write_text("y = 1\n")
    (tmp_workspace / "visible.py").write_text("z = 1\n")
    fc = FileToolsConfig(root=tmp_workspace)
    rc = CodeRagConfig(file_cfg=fc)
    idx = CodeRagIndex(rc)
    n = idx.build()
    assert n == 1  # only visible.py


def test_tokenize_splits_camelcase():
    from kairo.tools.code_rag import _tokenize
    tokens = _tokenize("getUserInfo fetchURL")
    assert "get" in tokens
    assert "user" in tokens
    assert "info" in tokens
    assert "fetch" in tokens
    assert "url" in tokens
