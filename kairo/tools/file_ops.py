"""File-reading tools.

All path arguments are resolved against the agent's *workspace root*
(see :class:`FileToolsConfig`). Reads outside the root are rejected by
the path-safety check, which prevents the model from exfiltrating
``/etc/passwd`` etc.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from kairo.errors import ToolError
from kairo.tools.base import tool
from kairo.utils import get_logger

log = get_logger("tools.file_ops")


@dataclass(slots=True)
class FileToolsConfig:
    root: Path
    # Max bytes returned by read_file. Larger files require offset/limit.
    max_read_bytes: int = 256 * 1024
    # Default line cap when no limit is supplied.
    default_line_limit: int = 2000
    # Allow reading symlinks that point outside the root. Off by default.
    allow_symlinks: bool = False


def _safe_resolve(root: Path, path: str, *, allow_symlinks: bool = False) -> Path:
    """Resolve ``path`` against ``root`` and verify it stays inside.

    Raises :class:`ToolError` if the resolved path escapes the root.
    """
    if not path:
        raise ToolError("read_file", "path is required")
    p = Path(path)
    if not p.is_absolute():
        p = root / p
    p = p.resolve(strict=False)
    root_resolved = root.resolve(strict=False)
    try:
        p.relative_to(root_resolved)
    except ValueError as exc:
        raise ToolError(
            "read_file",
            f"Path {path!r} resolves outside the workspace root {root_resolved}",
        ) from exc
    if not allow_symlinks and p.is_symlink():
        raise ToolError("read_file", f"Path {path!r} is a symlink (disallowed)")
    return p


def make_file_tools(cfg: FileToolsConfig):
    """Build a set of file tools bound to ``cfg``.

    We close over ``cfg`` rather than making it a global so multiple
    agents with different roots can coexist in the same process.
    """

    @tool(name="read_file")
    def read_file(path: str, offset: int = 0, limit: int | None = None) -> str:
        """Read a UTF-8 text file from the workspace.

        Args:
            path: Workspace-relative or absolute path.
            offset: 1-indexed line number to start reading from.
            limit: Max number of lines to return. Defaults to {default}.

        Returns:
            The file contents prefixed with ``cat -n``-style line numbers.
        """
        p = _safe_resolve(cfg.root, path, allow_symlinks=cfg.allow_symlinks)
        if not p.exists():
            raise ToolError("read_file", f"File not found: {path!r}")
        if not p.is_file():
            raise ToolError("read_file", f"Not a file: {path!r}")
        size = p.stat().st_size
        if size > cfg.max_read_bytes and limit is None:
            raise ToolError(
                "read_file",
                f"File is {size} bytes (> {cfg.max_read_bytes}); "
                "pass an explicit ``limit`` to read it in chunks",
            )
        if limit is None:
            limit = cfg.default_line_limit
        offset = max(0, offset)
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise ToolError("read_file", f"Could not read {path!r}: {exc}") from exc
        lines = text.splitlines()
        end = offset + limit if limit and limit > 0 else len(lines)
        out_lines = [
            f"{i + 1:>6}\t{line}" for i, line in enumerate(lines[offset:end], start=offset)
        ]
        header = f"== {p} (lines {offset + 1}-{min(end, len(lines))} of {len(lines)}) =="
        return "\n".join([header, *out_lines])

    @tool(name="list_dir")
    def list_dir(path: str = ".") -> str:
        """List entries in a workspace directory.

        Args:
            path: Directory to list. Defaults to the workspace root.

        Returns:
            One entry per line, ``/`` suffix for directories.
        """
        p = _safe_resolve(cfg.root, path, allow_symlinks=cfg.allow_symlinks)
        if not p.exists():
            raise ToolError("list_dir", f"Directory not found: {path!r}")
        if not p.is_dir():
            raise ToolError("list_dir", f"Not a directory: {path!r}")
        entries = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
        lines = []
        for e in entries:
            suffix = "/" if e.is_dir() else ""
            lines.append(f"{e.name}{suffix}")
        return "\n".join(lines) if lines else "(empty)"

    @tool(name="glob_files")
    def glob_files(pattern: str, path: str = ".") -> str:
        """Glob-match files under ``path``.

        Args:
            pattern: Glob pattern (e.g. ``**/*.py``).
            path: Directory to search in. Defaults to root.

        Returns:
            One path per line, workspace-relative.
        """
        base = _safe_resolve(cfg.root, path, allow_symlinks=cfg.allow_symlinks)
        if not base.is_dir():
            raise ToolError("glob_files", f"Not a directory: {path!r}")
        matches = sorted(base.glob(pattern))
        if not matches:
            return "(no matches)"
        root = cfg.root.resolve()
        rels = [str(m.relative_to(root)) if m.is_relative_to(root) else str(m) for m in matches]
        return "\n".join(rels[:1000])

    @tool(name="write_file", tags=("mutating",))
    def write_file(path: str, content: str, create_dirs: bool = True) -> str:
        """Write ``content`` to ``path`` (overwrites). Mutating.

        Args:
            path: Workspace-relative or absolute path.
            content: Full text to write.
            create_dirs: Create parent directories if missing.
        """
        p = _safe_resolve(cfg.root, path, allow_symlinks=False)
        if create_dirs:
            p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"Wrote {len(content)} chars to {p.relative_to(cfg.root.resolve())}"

    @tool(name="delete_file", tags=("dangerous", "mutating"))
    def delete_file(path: str) -> str:
        """Delete a file. Tagged dangerous — requires confirmation."""
        p = _safe_resolve(cfg.root, path, allow_symlinks=False)
        if not p.exists():
            raise ToolError("delete_file", f"File not found: {path!r}")
        if p.is_dir():
            raise ToolError("delete_file", f"Refusing to delete directory {path!r}; use a shell tool")
        p.unlink()
        return f"Deleted {p.relative_to(cfg.root.resolve())}"

    return [read_file, list_dir, glob_files, write_file, delete_file]
