"""Kairo tool package — registry factory + builtin tool bundles."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from kairo.tools.base import ToolRegistry, register_all
from kairo.tools.code_rag import CodeRagConfig, make_code_rag_tools
from kairo.tools.edit import EditToolsConfig, make_edit_tools
from kairo.tools.file_ops import FileToolsConfig, make_file_tools
from kairo.tools.guardrails import SpamGuard, SpamGuardConfig
from kairo.tools.search import SearchToolsConfig, make_search_tools
from kairo.tools.shell import ShellToolsConfig, make_shell_tools
from kairo.tools.swe import SWEToolsConfig, make_swe_tools
from kairo.tools.todo import TodoStore, make_todo_tools
from kairo.tools.web import WebToolsConfig, make_web_tools
from kairo.tools.web_design import WebDesignToolsConfig, make_web_design_tools
from kairo.utils import get_logger

log = get_logger("tools")


@dataclass(slots=True)
class ToolBundleConfig:
    """Config for :func:`build_default_registry`."""

    workspace: Path
    # Toggle which bundles are loaded.
    enable_file: bool = True
    enable_edit: bool = True
    enable_search: bool = True
    enable_shell: bool = True
    enable_web: bool = True
    enable_todo: bool = True
    enable_swe: bool = True
    enable_web_design: bool = True
    enable_code_rag: bool = True
    enable_browser: bool = False  # opt-in — requires agent-browser CLI
    enable_swarm: bool = False  # opt-in — needs KairoConfig
    # Per-bundle tuning. Leave None to use defaults.
    file_cfg: FileToolsConfig | None = None
    edit_cfg: EditToolsConfig | None = None
    search_cfg: SearchToolsConfig | None = None
    shell_cfg: ShellToolsConfig | None = None
    web_cfg: WebToolsConfig | None = None
    swe_cfg: SWEToolsConfig | None = None
    web_design_cfg: WebDesignToolsConfig | None = None
    code_rag_cfg: CodeRagConfig | None = None
    # Spam guard config.
    spam_guard_cfg: SpamGuardConfig = field(default_factory=SpamGuardConfig)


def build_default_registry(cfg: ToolBundleConfig) -> tuple[ToolRegistry, SpamGuard, TodoStore]:
    """Build a ToolRegistry pre-loaded with all builtin tools.

    Returns the registry, the spam guard, and the shared TODO store (the
    agent loop needs references to all three).
    """
    registry = ToolRegistry()
    guard = SpamGuard(cfg.spam_guard_cfg)
    todo_store = TodoStore()

    root = cfg.workspace.resolve()
    file_cfg = cfg.file_cfg or FileToolsConfig(root=root)

    if cfg.enable_file:
        for fn in make_file_tools(file_cfg):
            register_all(registry, fn)

    if cfg.enable_edit:
        edit_cfg = cfg.edit_cfg or EditToolsConfig(file_cfg=file_cfg)
        for fn in make_edit_tools(edit_cfg):
            register_all(registry, fn)

    if cfg.enable_search:
        search_cfg = cfg.search_cfg or SearchToolsConfig(file_cfg=file_cfg)
        for fn in make_search_tools(search_cfg):
            register_all(registry, fn)

    if cfg.enable_shell:
        shell_cfg = cfg.shell_cfg or ShellToolsConfig(file_cfg=file_cfg)
        for fn in make_shell_tools(shell_cfg):
            register_all(registry, fn)

    if cfg.enable_web:
        web_cfg = cfg.web_cfg or WebToolsConfig()
        for fn in make_web_tools(web_cfg):
            register_all(registry, fn)

    if cfg.enable_todo:
        for fn in make_todo_tools(todo_store):
            register_all(registry, fn)

    if cfg.enable_swe:
        swe_cfg = cfg.swe_cfg or SWEToolsConfig(file_cfg=file_cfg)
        for fn in make_swe_tools(swe_cfg):
            register_all(registry, fn)

    if cfg.enable_web_design:
        wd_cfg = cfg.web_design_cfg or WebDesignToolsConfig(file_cfg=file_cfg)
        for fn in make_web_design_tools(wd_cfg):
            register_all(registry, fn)

    if cfg.enable_code_rag:
        cr_cfg = cfg.code_rag_cfg or CodeRagConfig(file_cfg=file_cfg)
        for fn in make_code_rag_tools(cr_cfg):
            register_all(registry, fn)

    if cfg.enable_browser:
        # Imported here so the browser module is optional.
        from kairo.tools.browser import BrowserToolsConfig, make_browser_tools
        br_cfg = BrowserToolsConfig()
        for fn in make_browser_tools(br_cfg):
            register_all(registry, fn)

    log.info("built tool registry with %d tools: %s", len(registry), registry.names())
    return registry, guard, todo_store


__all__ = [
    "ToolBundleConfig",
    "build_default_registry",
    "ToolRegistry",
    "SpamGuard",
    "SpamGuardConfig",
    "TodoStore",
]
