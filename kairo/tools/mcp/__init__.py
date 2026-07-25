"""MCP (Model Context Protocol) tool bridge.

MCP is an open protocol that lets external "MCP servers" expose tools,
resources, and prompts to any MCP client. Kairo can act as an MCP client
and surface those servers' tools alongside its built-in tools — so the
agent can call into MCP-provided capabilities (filesystem servers, git
servers, database servers, browser servers, etc.) without any custom
glue code.

Protocol reference: https://modelcontextprotocol.io/

Two transports are supported:
  * ``stdio`` — Kairo spawns the MCP server as a subprocess and talks
    JSON-RPC over its stdin/stdout. The simplest path for local servers.
  * ``http`` — Kairo talks to an already-running HTTP+SSE MCP server.

This module is *transport-light*: we implement enough of the JSON-RPC
layer to list tools and invoke them, but we don't try to be a full MCP
SDK. If you need richer behaviour, drop in the official `mcp` PyPI
package and use :class:`MCPClient` as the Kairo-side adapter.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

from kairo.errors import KairoError, ToolError
from kairo.tools.base import ToolRegistry, register_all, tool
from kairo.types import ToolSpec
from kairo.utils import get_logger

log = get_logger("tools.mcp")


# ---------------------------------------------------------------------------
# JSON-RPC primitives
# ---------------------------------------------------------------------------

class MCPError(KairoError):
    """An MCP server returned an error response."""

    def __init__(self, code: int, message: str, data: Any | None = None) -> None:
        super().__init__(f"[mcp:{code}] {message}")
        self.code = code
        self.data = data


def _make_request(method: str, params: dict | None = None, req_id: int = 1) -> bytes:
    msg = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        msg["params"] = params
    return (json.dumps(msg) + "\n").encode("utf-8")


def _parse_response(line: str) -> dict:
    try:
        return json.loads(line)
    except json.JSONDecodeError as exc:
        raise MCPError(-32700, f"invalid JSON from server: {exc}") from exc


# ---------------------------------------------------------------------------
# Stdio transport
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class StdioServerConfig:
    """Config for a stdio MCP server."""

    command: list[str]
    """Argv for the server process."""
    env: dict[str, str] = field(default_factory=dict)
    """Extra env vars (merged over os.environ)."""
    cwd: Path | None = None
    """Working directory for the server process."""
    startup_timeout_s: float = 10.0
    """How long to wait for the server to be ready."""


class _StdioTransport:
    """Minimal JSON-RPC-over-stdio transport for an MCP server."""

    def __init__(self, cfg: StdioServerConfig) -> None:
        self.cfg = cfg
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._next_id = 1

    def start(self) -> None:
        env = {**os.environ, **self.cfg.env}
        self._proc = subprocess.Popen(
            self.cfg.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=str(self.cfg.cwd) if self.cfg.cwd else None,
            text=True,
            bufsize=1,
        )
        # Send initialize handshake.
        resp = self.call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "kairo", "version": "0.1.0"},
        })
        log.info("MCP server initialized: %s", resp.get("serverInfo", {}))
        # Send initialized notification (no response expected).
        self.notify("notifications/initialized", {})

    def stop(self) -> None:
        if self._proc is None:
            return
        try:
            if self._proc.stdin:
                self._proc.stdin.close()
            self._proc.terminate()
            try:
                self._proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        finally:
            self._proc = None

    def call(self, method: str, params: dict | None = None, timeout: float = 30.0) -> dict:
        if self._proc is None or self._proc.stdin is None or self._proc.stdout is None:
            raise MCPError(-32000, "transport not started")
        with self._lock:
            req_id = self._next_id
            self._next_id += 1
            payload = _make_request(method, params, req_id=req_id)
            self._proc.stdin.write(payload.decode("utf-8"))
            self._proc.stdin.flush()
            # Read lines until we see a response with our id.
            deadline = time.time() + timeout
            while time.time() < deadline:
                line = self._proc.stdout.readline()
                if not line:
                    raise MCPError(-32000, "server closed stdout")
                line = line.strip()
                if not line:
                    continue
                msg = _parse_response(line)
                # Skip notifications (no id).
                if "id" not in msg:
                    continue
                if msg["id"] != req_id:
                    # Out-of-order; skip (shouldn't happen with a single
                    # outstanding request, but be defensive).
                    continue
                if "error" in msg:
                    err = msg["error"]
                    raise MCPError(err.get("code", -1), err.get("message", "unknown"))
                return msg.get("result", {})
            raise MCPError(-32000, f"timed out waiting for response to {method!r}")

    def notify(self, method: str, params: dict | None = None) -> None:
        if self._proc is None or self._proc.stdin is None:
            return
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        with self._lock:
            self._proc.stdin.write(json.dumps(msg) + "\n")
            self._proc.stdin.flush()


# ---------------------------------------------------------------------------
# HTTP transport (basic — SSE not fully implemented; for servers that
# expose a simple /message POST endpoint)
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class HttpServerConfig:
    url: str
    api_key: str | None = None
    timeout_s: float = 30.0


class _HttpTransport:
    """HTTP transport for MCP servers that expose JSON-RPC over POST."""

    def __init__(self, cfg: HttpServerConfig) -> None:
        self.cfg = cfg
        self._next_id = 1

    def start(self) -> None:
        # Stateless transport; nothing to start. We do an initialize call
        # to verify connectivity.
        self.call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "kairo", "version": "0.1.0"},
        })

    def stop(self) -> None:
        pass

    def call(self, method: str, params: dict | None = None, timeout: float | None = None) -> dict:
        import httpx
        to = timeout or self.cfg.timeout_s
        msg = {
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": method,
        }
        if params is not None:
            msg["params"] = params
        self._next_id += 1
        headers = {"Content-Type": "application/json"}
        if self.cfg.api_key:
            headers["Authorization"] = f"Bearer {self.cfg.api_key}"
        try:
            with httpx.Client(timeout=to) as c:
                resp = c.post(self.cfg.url, json=msg, headers=headers)
        except httpx.HTTPError as exc:
            raise MCPError(-32000, f"HTTP error: {exc}") from exc
        if resp.status_code >= 400:
            raise MCPError(-32000, f"HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        if "error" in data:
            err = data["error"]
            raise MCPError(err.get("code", -1), err.get("message", "unknown"))
        return data.get("result", {})

    def notify(self, method: str, params: dict | None = None) -> None:
        # HTTP transport: notifications are best-effort POSTs.
        try:
            self.call(method, params, timeout=2.0)
        except MCPError:
            pass


# ---------------------------------------------------------------------------
# MCP client — wraps a transport and exposes its tools
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class MCPTool:
    """A tool discovered from an MCP server."""

    name: str
    description: str
    schema: dict[str, Any]
    server_name: str


class MCPClient:
    """A single MCP server connection.

    Lifecycle:
      1. ``client = MCPClient("name", cfg)``
      2. ``client.connect()`` — starts the transport, does the handshake.
      3. ``client.list_tools()`` — returns ``list[MCPTool]``.
      4. ``client.call_tool(name, args)`` — invokes a tool.
      5. ``client.close()`` — shuts down the transport.
    """

    def __init__(self, name: str, cfg: StdioServerConfig | HttpServerConfig) -> None:
        self.name = name
        self.cfg = cfg
        if isinstance(cfg, StdioServerConfig):
            self._transport: _StdioTransport | _HttpTransport = _StdioTransport(cfg)
        elif isinstance(cfg, HttpServerConfig):
            self._transport = _HttpTransport(cfg)
        else:
            raise TypeError(f"unknown MCP transport config: {type(cfg).__name__}")
        self._tools: list[MCPTool] = []
        self._connected = False

    # -- lifecycle -----------------------------------------------------

    def connect(self) -> None:
        if self._connected:
            return
        self._transport.start()
        self._connected = True
        # Discover tools eagerly so list_tools() is free.
        self._tools = self._fetch_tools()
        log.info("MCP server %r connected with %d tools", self.name, len(self._tools))

    def close(self) -> None:
        if not self._connected:
            return
        try:
            self._transport.stop()
        finally:
            self._connected = False

    # -- introspection -------------------------------------------------

    def list_tools(self) -> list[MCPTool]:
        if not self._connected:
            self.connect()
        return list(self._tools)

    def _fetch_tools(self) -> list[MCPTool]:
        result = self._transport.call("tools/list", {})
        tools = []
        for raw in result.get("tools", []) or []:
            tools.append(MCPTool(
                name=raw.get("name", ""),
                description=raw.get("description", ""),
                schema=raw.get("inputSchema", {"type": "object", "properties": {}}),
                server_name=self.name,
            ))
        return tools

    # -- invocation ----------------------------------------------------

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        if not self._connected:
            self.connect()
        result = self._transport.call("tools/call", {"name": name, "arguments": arguments})
        # MCP returns content as a list of blocks (text/image/etc).
        # We flatten text blocks into a single string for simplicity.
        content = result.get("content", []) or []
        is_error = result.get("isError", False)
        text_parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text_parts.append(block.get("text", ""))
        out = "\n".join(text_parts) if text_parts else result
        if is_error:
            raise ToolError(f"mcp:{self.name}:{name}", out if isinstance(out, str) else "tool error")
        return out


# ---------------------------------------------------------------------------
# Registry bridge — expose MCP tools as Kairo tools
# ---------------------------------------------------------------------------

def register_mcp_client(registry: ToolRegistry, client: MCPClient) -> list[str]:
    """Register every tool from an MCP client into a Kairo ToolRegistry.

    Returns the list of Kairo-side tool names that were registered
    (prefixed with ``mcp_<server>_`` to avoid collisions).

    The MCP client's lifecycle (connect/close) is *not* managed here —
    the caller is responsible for keeping the client alive as long as
    the registry is in use.
    """
    mcp_tools = client.list_tools()
    registered: list[str] = []
    for mt in mcp_tools:
        # Compose a Kairo-safe name.
        kairo_name = f"mcp_{client.name}_{mt.name}"
        # Capture mt in a closure factory to avoid late-binding bugs.
        def _make_fn(tool: MCPTool):
            def _fn(**kwargs: Any) -> Any:
                return client.call_tool(tool.name, dict(kwargs))
            _fn.__doc__ = tool.description or f"MCP tool {tool.name} from server {client.name}"
            return _fn
        fn = _make_fn(mt)
        # Stash the spec so register_all can find it.
        fn._kairo_spec = {  # type: ignore[attr-defined]
            "name": kairo_name,
            "description": mt.description or f"MCP tool {mt.name}",
            "parameters": mt.schema,
            "tags": ("mcp",),
        }
        register_all(registry, fn)
        registered.append(kairo_name)
    log.info("registered %d MCP tools from server %r", len(registered), client.name)
    return registered


# ---------------------------------------------------------------------------
# Multi-server manager
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class MCPManager:
    """Manages multiple MCP clients and registers them all into a registry.

    Usage::

        mgr = MCPManager()
        mgr.add("fs", StdioServerConfig(command=["npx", "mcp-server-fs", "/tmp"]))
        mgr.connect_all()
        mgr.register_all(my_registry)
        # ... use the registry ...
        mgr.close_all()
    """

    clients: dict[str, MCPClient] = field(default_factory=dict)

    def add(self, name: str, cfg: StdioServerConfig | HttpServerConfig) -> MCPClient:
        if name in self.clients:
            raise ValueError(f"MCP server {name!r} already added")
        client = MCPClient(name, cfg)
        self.clients[name] = client
        return client

    def connect_all(self) -> None:
        for client in self.clients.values():
            try:
                client.connect()
            except Exception as exc:  # noqa: BLE001
                log.warning("MCP server %r failed to connect: %s", client.name, exc)

    def close_all(self) -> None:
        for client in self.clients.values():
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass

    def register_all(self, registry: ToolRegistry) -> list[str]:
        names: list[str] = []
        for client in self.clients.values():
            try:
                names.extend(register_mcp_client(registry, client))
            except Exception as exc:  # noqa: BLE001
                log.warning("MCP server %r register failed: %s", client.name, exc)
        return names

    def list_all_tools(self) -> list[MCPTool]:
        out: list[MCPTool] = []
        for client in self.clients.values():
            try:
                out.extend(client.list_tools())
            except Exception:  # noqa: BLE001
                pass
        return out
