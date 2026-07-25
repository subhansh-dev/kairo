"""Dynamic tool discovery + plugin system — extend agents at runtime.

Kairo's :class:`ToolRegistry` is built once per agent run. This module
adds the ability to discover + load tools *during* a run, based on
what the agent is actually doing.

Two patterns:

  * **Dynamic discovery** — the agent calls a ``discover_tools`` tool
    that searches a directory (e.g. ``./plugins/``) for Python files
    with ``@tool``-decorated functions and registers them on the fly.
    Next turn, the new tools are visible to the model.

  * **Plugin manager** — a higher-level abstraction. Plugins are
    Python packages with a ``register(registry: ToolRegistry) -> None``
    function. The manager loads them from a configured directory and
    can also install/uninstall them at runtime.

Both patterns let third parties extend an agent without recompiling
Kairo itself — useful for domain-specific tool packs (e.g. a Salesforce
plugin, a Stripe plugin, a custom internal-tools plugin).

Security: by default, plugins are loaded with ``importlib.util`` (no
``sys.path`` mutation). Set ``allow_arbitrary_imports=True`` to let
plugins import arbitrary packages — only do this if you trust the
plugin source.
"""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from kairo.errors import KairoError
from kairo.tools.base import ToolRegistry, register_all, tool
from kairo.utils import get_logger

log = get_logger("tools.plugins")


@dataclass(slots=True)
class PluginInfo:
    """Metadata about a loaded plugin."""

    name: str
    path: Path
    tools_registered: list[str] = field(default_factory=list)
    error: str | None = None


class PluginManager:
    """Discovers and loads plugins from a directory.

    A plugin is a Python file with one of:
      * Top-level ``@tool``-decorated functions (auto-registered).
      * A ``register(registry: ToolRegistry) -> None`` function (called
        with the registry so the plugin can do custom registration).

    Usage::

        mgr = PluginManager(Path("./plugins"))
        mgr.load_all(registry)
        # ... agent can now use the plugin's tools ...
        # Later, load a new plugin that was just dropped in:
        info = mgr.load_one(Path("./plugins/new_plugin.py"), registry)
    """

    def __init__(self, plugins_dir: Path | None = None,
                 *, allow_arbitrary_imports: bool = False) -> None:
        self.plugins_dir = plugins_dir
        self.allow_arbitrary_imports = allow_arbitrary_imports
        self._loaded: dict[str, PluginInfo] = {}

    def discover(self) -> list[Path]:
        """Find all .py files in ``plugins_dir``."""
        if self.plugins_dir is None or not self.plugins_dir.is_dir():
            return []
        return sorted(p for p in self.plugins_dir.glob("*.py") if p.is_file())

    def load_all(self, registry: ToolRegistry) -> list[PluginInfo]:
        """Load every discovered plugin into ``registry``."""
        infos: list[PluginInfo] = []
        for path in self.discover():
            info = self.load_one(path, registry)
            infos.append(info)
        return infos

    def load_one(self, path: Path | str, registry: ToolRegistry) -> PluginInfo:
        """Load a single plugin file."""
        path = Path(path)
        if not path.is_file():
            raise KairoError(f"plugin file not found: {path}")
        plugin_name = path.stem
        info = PluginInfo(name=plugin_name, path=path)
        try:
            # Load the module without adding to sys.path.
            spec = importlib.util.spec_from_file_location(
                f"kairo_plugin_{plugin_name}", path,
            )
            if spec is None or spec.loader is None:
                raise KairoError(f"could not load plugin spec for {path}")
            mod = importlib.util.module_from_spec(spec)
            # Make the plugin's directory importable for relative imports.
            if self.allow_arbitrary_imports:
                plugin_dir = str(path.parent)
                if plugin_dir not in sys.path:
                    sys.path.insert(0, plugin_dir)
            spec.loader.exec_module(mod)
            # Auto-register @tool-decorated functions.
            registered: list[str] = []
            for attr_name in dir(mod):
                fn = getattr(mod, attr_name)
                if callable(fn) and hasattr(fn, "_kairo_spec"):
                    try:
                        register_all(registry, fn)
                        registered.append(fn._kairo_spec["name"])
                    except Exception as exc:  # noqa: BLE001
                        log.warning("failed to register %s from plugin %s: %s",
                                    attr_name, plugin_name, exc)
            # Call the plugin's register() function if it exists.
            register_fn: Callable[[ToolRegistry], None] | None = getattr(mod, "register", None)
            if callable(register_fn):
                try:
                    register_fn(registry)
                except Exception as exc:  # noqa: BLE001
                    log.warning("plugin %s register() failed: %s", plugin_name, exc)
                    info.error = str(exc)
            info.tools_registered = registered
            self._loaded[plugin_name] = info
            log.info("loaded plugin %s: %d tools registered", plugin_name, len(registered))
        except Exception as exc:  # noqa: BLE001
            info.error = str(exc)
            log.warning("plugin %s failed to load: %s", plugin_name, exc)
        return info

    def unload(self, name: str, registry: ToolRegistry) -> bool:
        """Unload a plugin by removing its tools from the registry."""
        info = self._loaded.get(name)
        if info is None:
            return False
        for tool_name in info.tools_registered:
            registry.unregister(tool_name)
        del self._loaded[name]
        log.info("unloaded plugin %s", name)
        return True

    def list_loaded(self) -> list[PluginInfo]:
        return list(self._loaded.values())

    def is_loaded(self, name: str) -> bool:
        return name in self._loaded


# ---------------------------------------------------------------------------
# Dynamic discovery tool — lets the agent trigger plugin loading
# ---------------------------------------------------------------------------

def make_discovery_tool(manager: PluginManager, registry: ToolRegistry):
    """Build a ``discover_tools`` tool that the agent can call.

    The agent calls this with an optional path to a plugin file. If no
    path is given, all plugins in the manager's directory are loaded.
    """

    @tool(name="discover_tools", tags=("plugin",))
    def discover_tools(path: str | None = None) -> str:
        """Discover and load additional tools from the plugins directory.

        Args:
            path: Optional path to a specific plugin file. When omitted,
                loads all .py files in the plugins directory.

        Returns:
            Summary of which plugins were loaded and which tools they added.
        """
        if path:
            info = manager.load_one(path, registry)
            if info.error:
                return f"Failed to load {path}: {info.error}"
            return f"Loaded plugin {info.name}: registered tools {info.tools_registered}"
        infos = manager.load_all(registry)
        if not infos:
            return "(no plugins found)"
        lines = []
        for info in infos:
            if info.error:
                lines.append(f"- {info.name}: FAILED ({info.error[:80]})")
            else:
                lines.append(f"- {info.name}: {info.tools_registered}")
        return "\n".join(lines)

    return discover_tools
