"""Search tools — ripgrep-backed grep + AST-aware symbol search.

Kairo ships ripgrep as the primary text-search backend because it is
fast, respects .gitignore by default, and produces stable, parseable
output. ``grep`` here is a thin wrapper; the heavy lifting is the rg
binary on PATH.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from kairo.errors import ToolError
from kairo.tools.base import tool
from kairo.tools.file_ops import FileToolsConfig, _safe_resolve
from kairo.utils import get_logger

log = get_logger("tools.search")


@dataclass(slots=True)
class SearchToolsConfig:
    file_cfg: FileToolsConfig
    # Max lines returned by grep before truncation.
    max_grep_lines: int = 200
    # Max file size ripgrep will search (MB).
    max_file_size_mb: int = 8


def make_search_tools(cfg: SearchToolsConfig):
    root = cfg.file_cfg.root

    def _ensure_rg() -> str:
        rg = shutil.which("rg")
        if rg is None:
            raise ToolError("grep", "ripgrep (rg) is not installed")
        return rg

    @tool(name="grep")
    def grep(
        pattern: str,
        path: str = ".",
        glob: str | None = None,
        file_type: str | None = None,
        ignore_case: bool = False,
        multiline: bool = False,
        max_results: int = 100,
    ) -> str:
        """Search file contents with ripgrep.

        Args:
            pattern: Regex pattern.
            path: Directory or file to search. Defaults to root.
            glob: Optional glob filter (e.g. ``*.py``).
            file_type: ripgrep type filter (e.g. ``py``, ``js``).
            ignore_case: Case-insensitive match.
            multiline: Allow ``.`` to match newlines.
            max_results: Cap on number of matching lines.

        Returns:
            ``path:line:match`` per line, truncated at max_results.
        """
        rg = _ensure_rg()
        base = _safe_resolve(root, path, allow_symlinks=False)
        if not base.exists():
            raise ToolError("grep", f"Path not found: {path!r}")
        cmd = [
            rg,
            "--no-heading",
            "--line-number",
            "--color=never",
            "--max-count", str(max_results),
        ]
        if ignore_case:
            cmd.append("-i")
        if multiline:
            cmd.append("-U")
        if glob:
            cmd += ["--glob", glob]
        if file_type:
            cmd += ["--type", file_type]
        cmd += ["--max-filesize", f"{cfg.max_file_size_mb}M"]
        cmd += [pattern, str(base)]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        except subprocess.TimeoutExpired as exc:
            raise ToolError("grep", f"ripgrep timed out after 30s") from exc
        if proc.returncode not in (0, 1):  # 1 = no matches
            raise ToolError(
                "grep",
                f"ripgrep exited {proc.returncode}: {proc.stderr.strip()[:500]}",
            )
        out = proc.stdout.rstrip()
        if not out:
            return "(no matches)"
        lines = out.splitlines()
        if len(lines) > cfg.max_grep_lines:
            lines = lines[: cfg.max_grep_lines]
            lines.append(f"... (truncated, {len(out.splitlines()) - cfg.max_grep_lines} more)")
        return "\n".join(lines)

    @tool(name="find_symbol")
    def find_symbol(symbol: str, path: str = ".", kind: str = "any") -> str:
        """Find symbol definitions (classes, functions, methods).

        Uses regex heuristics — works for Python, JS, TS, Go, Rust, Java.
        For precise results use a real LSP; this is a fast approximation.

        Args:
            symbol: Symbol name to find.
            path: Directory to search. Defaults to root.
            kind: ``class`` | ``function`` | ``any``.
        """
        # Patterns cover the common "def X", "class X", "fn X", "func X",
        # "public X", "void X", etc.
        patterns = {
            "class": rf"\b(class|struct|interface|object)\s+{re.escape(symbol)}\b",
            "function": rf"\b(def|fn|func|function|void|public|private|protected)\s+{re.escape(symbol)}\b",
            "any": rf"\b(class|struct|interface|object|def|fn|func|function|void)\s+{re.escape(symbol)}\b",
        }
        pat = patterns.get(kind, patterns["any"])
        return grep(
            pattern=pat,
            path=path,
            ignore_case=False,
            max_results=50,
        )

    return [grep, find_symbol]
