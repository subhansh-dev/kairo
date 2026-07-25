"""Editing tools — surgical string replacements inside files.

These mirror the semantics of Claude Code's edit tools (replace a unique
substring, multi-edit, etc.) without copying any code. The goal is the
same: avoid the model rewriting whole files when a 3-line patch suffices,
which keeps diffs reviewable and tokens cheap.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from kairo.errors import ToolError
from kairo.tools.base import tool
from kairo.tools.file_ops import FileToolsConfig, _safe_resolve
from kairo.utils import get_logger

log = get_logger("tools.edit")


@dataclass(slots=True)
class EditToolsConfig:
    file_cfg: FileToolsConfig
    # When True, edits require the file to have been read first in this
    # session — prevents blind edits to huge files. Defaults to False
    # because most free local models don't reliably chain read-then-edit.
    require_read_first: bool = False


def make_edit_tools(cfg: EditToolsConfig):
    root = cfg.file_cfg.root
    _read_set: set[Path] = set()

    def _mark_read(p: Path) -> None:
        _read_set.add(p.resolve())

    def _check_read(p: Path) -> None:
        if not cfg.require_read_first:
            return
        if p.resolve() not in _read_set:
            raise ToolError(
                "edit_file",
                f"File {p} must be read with read_file before editing",
            )

    @tool(name="edit_file", tags=("mutating",))
    def edit_file(
        path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> str:
        """Replace ``old_string`` with ``new_string`` in ``path``.

        The match must be unique unless ``replace_all`` is True. Fails
        loudly on missing or ambiguous matches so the model can recover
        rather than silently corrupting files.
        """
        p = _safe_resolve(root, path, allow_symlinks=False)
        if not p.is_file():
            raise ToolError("edit_file", f"File not found: {path!r}")
        _check_read(p)
        text = p.read_text(encoding="utf-8", errors="replace")
        count = text.count(old_string)
        if count == 0:
            raise ToolError(
                "edit_file",
                f"old_string not found in {path!r}. "
                "Re-read the file and use the exact substring including whitespace.",
            )
        if count > 1 and not replace_all:
            raise ToolError(
                "edit_file",
                f"old_string appears {count} times in {path!r}; pass replace_all=True "
                "or include more context to make it unique",
            )
        new_text = text.replace(old_string, new_string) if replace_all else text.replace(
            old_string, new_string, 1
        )
        p.write_text(new_text, encoding="utf-8")
        _mark_read(p)
        n = count if replace_all else 1
        return f"Replaced {n} occurrence(s) in {p.relative_to(root.resolve())}"

    @tool(name="multi_edit", tags=("mutating",))
    def multi_edit(path: str, edits: list[dict]) -> str:
        """Apply multiple edits to ``path`` in order.

        Each edit is ``{"old_string":..., "new_string":..., "replace_all": bool}``.
        Edits are atomic — if any fails, the file is left unchanged.
        """
        if not isinstance(edits, list):
            raise ToolError("multi_edit", "edits must be a list of objects")
        p = _safe_resolve(root, path, allow_symlinks=False)
        if not p.is_file():
            raise ToolError("multi_edit", f"File not found: {path!r}")
        _check_read(p)
        text = p.read_text(encoding="utf-8", errors="replace")
        original = text
        applied = 0
        try:
            for i, e in enumerate(edits):
                if not isinstance(e, dict):
                    raise ToolError("multi_edit", f"edit #{i} is not an object")
                old = e.get("old_string")
                new = e.get("new_string", "")
                ra = bool(e.get("replace_all", False))
                if not old:
                    raise ToolError("multi_edit", f"edit #{i} missing old_string")
                count = text.count(old)
                if count == 0:
                    raise ToolError(
                        "multi_edit",
                        f"edit #{i}: old_string not found",
                    )
                if count > 1 and not ra:
                    raise ToolError(
                        "multi_edit",
                        f"edit #{i}: old_string appears {count} times; "
                        "pass replace_all=True or add context",
                    )
                text = text.replace(old, new) if ra else text.replace(old, new, 1)
                applied += count if ra else 1
        except ToolError:
            # Atomic: restore original text on failure.
            p.write_text(original, encoding="utf-8")
            raise
        p.write_text(text, encoding="utf-8")
        _mark_read(p)
        return f"Applied {len(edits)} edit(s), {applied} replacement(s) in {p.relative_to(root.resolve())}"

    @tool(name="append_file", tags=("mutating",))
    def append_file(path: str, content: str, create_if_missing: bool = True) -> str:
        """Append ``content`` to ``path``. Creates the file if missing."""
        p = _safe_resolve(root, path, allow_symlinks=False)
        if not p.exists() and not create_if_missing:
            raise ToolError("append_file", f"File not found: {path!r}")
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "a", encoding="utf-8") as f:
            f.write(content)
        _mark_read(p)
        return f"Appended {len(content)} chars to {p.relative_to(root.resolve())}"

    # Expose a hook so the agent can mark a file as read after using
    # read_file (which lives in a different tool module). This keeps the
    # edit module decoupled from the file module's callables.
    def mark_read_hook(path: str) -> None:
        p = _safe_resolve(root, path, allow_symlinks=False)
        _mark_read(p)

    edit_file._kairo_mark_read = mark_read_hook  # type: ignore[attr-defined]
    list_tools = [edit_file, multi_edit, append_file]
    return list_tools
