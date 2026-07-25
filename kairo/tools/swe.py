"""SWE-bench-style tools — repo navigation, AST parsing, dependency graph.

These tools give the agent "code intelligence" beyond simple file reads:
  * ``find_references`` — find all callers of a function/class.
  * ``get_call_graph`` — build a call graph for a directory.
  * ``get_imports`` — list what a file imports.
  * ``get_importers`` — list files that import a given module.
  * ``get_signature`` — extract function/method signatures with types.
  * ``get_class_hierarchy`` — walk the MRO of a class.

All tools use Python's stdlib ``ast`` module so they work without any
extra dependencies, and they work on Python source files. JS/TS/Go/Rust
support is a thin regex layer on top of the existing search tools.
"""

from __future__ import annotations

import ast
import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from kairo.errors import ToolError
from kairo.tools.base import tool
from kairo.tools.file_ops import FileToolsConfig, _safe_resolve
from kairo.utils import get_logger

log = get_logger("tools.swe")


@dataclass(slots=True)
class SWEToolsConfig:
    file_cfg: FileToolsConfig
    # Max files to scan for call-graph / references.
    max_files: int = 500


def make_swe_tools(cfg: SWEToolsConfig):
    root = cfg.file_cfg.root

    @tool(name="get_imports")
    def get_imports(path: str) -> str:
        """List the imports in a Python file.

        Returns a JSON array of ``{"module":..., "name":..., "line":N}``.
        Works on Python files; returns an empty array for non-Python files.
        """
        p = _safe_resolve(root, path, allow_symlinks=False)
        if not p.is_file():
            raise ToolError("get_imports", f"file not found: {path!r}")
        if p.suffix != ".py":
            return "[]"
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError as exc:
            raise ToolError("get_imports", f"could not parse {path!r}: {exc}") from exc
        out = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for n in node.names:
                    out.append({"module": n.name, "name": n.asname or n.name, "line": node.lineno})
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                for n in node.names:
                    out.append({"module": mod, "name": n.asname or n.name, "line": node.lineno})
        return json.dumps(out, indent=2)

    @tool(name="get_importers")
    def get_importers(module: str, path: str = ".") -> str:
        """Find files that import ``module``.

        Args:
            module: The module name (e.g. ``foo.bar`` or ``foo``).
            path: Directory to search. Defaults to root.

        Returns:
            One path per line.
        """
        base = _safe_resolve(root, path, allow_symlinks=False)
        if not base.exists():
            raise ToolError("get_importers", f"path not found: {path!r}")
        # The module could be imported as `from module import ...` or
        # `import module` or `import module.sub`.
        target = module.split(".")[0]
        matches: list[str] = []
        for p in _iter_python_files(base, cfg.max_files):
            try:
                tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for n in node.names:
                        if n.name.split(".")[0] == target:
                            matches.append(str(p.relative_to(root.resolve())))
                            break
                elif isinstance(node, ast.ImportFrom):
                    if (node.module or "").split(".")[0] == target:
                        matches.append(str(p.relative_to(root.resolve())))
                        break
        return "\n".join(sorted(set(matches))) if matches else "(no importers)"

    @tool(name="get_signature")
    def get_signature(path: str, symbol: str | None = None) -> str:
        """Extract function/method/class signatures from a Python file.

        Args:
            path: Python file to inspect.
            symbol: Optional name to filter for. When omitted, returns
                every top-level def/class.

        Returns:
            JSON array of ``{"name":..., "kind":..., "args":..., "line":N, "end_line":N}``.
        """
        p = _safe_resolve(root, path, allow_symlinks=False)
        if not p.is_file():
            raise ToolError("get_signature", f"file not found: {path!r}")
        if p.suffix != ".py":
            return "[]"
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError as exc:
            raise ToolError("get_signature", f"could not parse: {exc}") from exc
        out = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if symbol and node.name != symbol:
                    continue
                out.append({
                    "name": node.name,
                    "kind": "async_function" if isinstance(node, ast.AsyncFunctionDef) else "function",
                    "args": _format_args(node.args),
                    "returns": _unparse(node.returns) if node.returns else None,
                    "line": node.lineno,
                    "end_line": getattr(node, "end_lineno", node.lineno),
                })
            elif isinstance(node, ast.ClassDef):
                if symbol and node.name != symbol:
                    continue
                methods = []
                for sub in node.body:
                    if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        methods.append(sub.name)
                out.append({
                    "name": node.name,
                    "kind": "class",
                    "methods": methods,
                    "line": node.lineno,
                    "end_line": getattr(node, "end_lineno", node.lineno),
                })
        return json.dumps(out, indent=2)

    @tool(name="find_references")
    def find_references(symbol: str, path: str = ".", file_type: str = "py") -> str:
        """Find all references to ``symbol`` under ``path``.

        Uses ripgrep under the hood for speed. Returns ``path:line:match``
        per line.
        """
        from kairo.tools.search import SearchToolsConfig, make_search_tools
        # We don't have access to the search tools' registry, so just
        # call rg directly.
        import subprocess
        import shutil
        rg = shutil.which("rg")
        if rg is None:
            raise ToolError("find_references", "ripgrep (rg) not installed")
        base = _safe_resolve(root, path, allow_symlinks=False)
        if not base.exists():
            raise ToolError("find_references", f"path not found: {path!r}")
        # Match the symbol as a word boundary.
        cmd = [
            rg, "--no-heading", "--line-number", "--color=never",
            "--type", file_type, "-w", symbol, str(base),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        except subprocess.TimeoutExpired as exc:
            raise ToolError("find_references", "ripgrep timed out") from exc
        out = proc.stdout.rstrip()
        if not out:
            return "(no references)"
        # Relativize paths to the workspace root for readability.
        lines = []
        for line in out.splitlines():
            # rg outputs "path:line:match" — split on first 2 colons.
            parts = line.split(":", 2)
            if len(parts) < 3:
                lines.append(line)
                continue
            p, ln, m = parts
            try:
                rp = Path(p).relative_to(root.resolve())
            except ValueError:
                rp = Path(p)
            lines.append(f"{rp}:{ln}:{m}")
        return "\n".join(lines[:200])

    @tool(name="get_call_graph")
    def get_call_graph(path: str = ".") -> str:
        """Build a function-level call graph for Python files under ``path``.

        Returns JSON: ``{"nodes": [...], "edges": [{"caller":..., "callee":...}]}``.
        Only functions defined in the scanned files appear as nodes;
        external calls (stdlib, third-party) are kept as edges but
        don't get their own nodes.
        """
        base = _safe_resolve(root, path, allow_symlinks=False)
        if not base.exists():
            raise ToolError("get_call_graph", f"path not found: {path!r}")
        # Step 1: walk every .py file, collect function defs and the
        # function-calls inside each one.
        file_funcs: dict[Path, set[str]] = defaultdict(set)
        edges: list[dict[str, str]] = []
        nodes: list[dict] = []
        for p in _iter_python_files(base, cfg.max_files):
            try:
                tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError:
                continue
            rel = str(p.relative_to(root.resolve()))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    file_funcs[p].add(node.name)
                    nodes.append({
                        "name": node.name,
                        "file": rel,
                        "line": node.lineno,
                    })
                    # Walk the body for Call nodes.
                    for sub in ast.walk(node):
                        if isinstance(sub, ast.Call):
                            callee = _call_name(sub.func)
                            if callee:
                                edges.append({
                                    "caller": f"{rel}::{node.name}",
                                    "callee": callee,
                                })
        return json.dumps({"nodes": nodes, "edges": edges}, indent=2)

    return [
        get_imports,
        get_importers,
        get_signature,
        find_references,
        get_call_graph,
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _iter_python_files(base: Path, max_files: int):
    count = 0
    for p in base.rglob("*.py"):
        if count >= max_files:
            return
        # Skip hidden dirs and __pycache__.
        if any(part.startswith(".") or part == "__pycache__" for part in p.parts):
            continue
        yield p
        count += 1


def _format_args(args: ast.arguments) -> str:
    parts = []
    # positional
    for a in args.posonlyargs + args.args:
        s = a.arg
        if a.annotation:
            s += ": " + _unparse(a.annotation)
        parts.append(s)
    if args.vararg:
        s = "*" + args.vararg.arg
        if args.vararg.annotation:
            s += ": " + _unparse(args.vararg.annotation)
        parts.append(s)
    elif args.kwonlyargs:
        parts.append("*")
    for a in args.kwonlyargs:
        s = a.arg
        if a.annotation:
            s += ": " + _unparse(a.annotation)
        parts.append(s)
    if args.kwarg:
        s = "**" + args.kwarg.arg
        if args.kwarg.annotation:
            s += ": " + _unparse(args.kwarg.annotation)
        parts.append(s)
    return ", ".join(parts)


def _unparse(node) -> str:
    try:
        return ast.unparse(node)
    except Exception:  # noqa: BLE001
        return "<unknown>"


def _call_name(node) -> str | None:
    """Extract a readable name from a Call node's func."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _call_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return None
