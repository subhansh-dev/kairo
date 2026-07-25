"""Tests for kairo.tools.mcp — MCP client + registry bridge.

We don't have a real MCP server to test against, so we test the
internal helpers (JSON-RPC framing, response parsing, registry bridge)
with mocks.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from kairo.tools.base import ToolRegistry
from kairo.tools.mcp import (
    MCPClient,
    MCPError,
    MCPManager,
    MCPTool,
    StdioServerConfig,
    _parse_response,
    register_mcp_client,
)


# ---------------------------------------------------------------------------
# JSON-RPC primitives
# ---------------------------------------------------------------------------

def test_parse_response_valid():
    msg = _parse_response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}')
    assert msg["result"] == {"tools": []}


def test_parse_response_invalid_json():
    with pytest.raises(MCPError) as exc:
        _parse_response("not json")
    assert exc.value.code == -32700


# ---------------------------------------------------------------------------
# Registry bridge — using a mock client
# ---------------------------------------------------------------------------

class _MockMCPClient:
    """Mock MCPClient that returns pre-baked tools without a real server."""

    def __init__(self, name: str, tools: list[MCPTool]):
        self.name = name
        self._tools = tools
        self.calls: list[tuple[str, dict]] = []

    def connect(self) -> None:
        pass

    def close(self) -> None:
        pass

    def list_tools(self) -> list[MCPTool]:
        return list(self._tools)

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        self.calls.append((name, arguments))
        return f"called {name} with {arguments}"


def test_register_mcp_client_creates_kairo_tools():
    client = _MockMCPClient("test", [
        MCPTool(name="foo", description="do foo",
                schema={"type": "object", "properties": {"x": {"type": "string"}}},
                server_name="test"),
        MCPTool(name="bar", description="do bar",
                schema={"type": "object", "properties": {}},
                server_name="test"),
    ])
    reg = ToolRegistry()
    # Use the bridge — it expects a real MCPClient but only uses the
    # public methods we mocked, so we can cast.
    names = register_mcp_client(reg, client)  # type: ignore[arg-type]
    assert "mcp_test_foo" in names
    assert "mcp_test_bar" in names
    assert reg.has("mcp_test_foo")
    assert reg.has("mcp_test_bar")


def test_registered_mcp_tool_invokes_client():
    client = _MockMCPClient("test", [
        MCPTool(name="foo", description="do foo",
                schema={"type": "object", "properties": {"x": {"type": "string"}}},
                server_name="test"),
    ])
    reg = ToolRegistry()
    register_mcp_client(reg, client)  # type: ignore[arg-type]
    rt = reg.get("mcp_test_foo")
    out = rt.fn(x="hello")
    assert "called foo" in out
    assert client.calls == [("foo", {"x": "hello"})]


def test_mcp_manager_lifecycle():
    mgr = MCPManager()
    # We can't actually connect to a server in tests, but we can test
    # the add/list/close API with mock clients.
    mock = _MockMCPClient("a", [
        MCPTool(name="t1", description="d1",
                schema={"type": "object"}, server_name="a"),
    ])
    mgr.clients["a"] = mock  # type: ignore[assignment]
    tools = mgr.list_all_tools()
    assert len(tools) == 1
    assert tools[0].name == "t1"
    # register_all should work too.
    reg = ToolRegistry()
    names = mgr.register_all(reg)
    assert "mcp_a_t1" in names


def test_mcp_manager_add_duplicate_raises():
    mgr = MCPManager()
    mgr.add("x", StdioServerConfig(command=["echo"]))
    with pytest.raises(ValueError):
        mgr.add("x", StdioServerConfig(command=["echo"]))


def test_mcp_error_carries_code():
    err = MCPError(-32601, "method not found")
    assert err.code == -32601
    assert "method not found" in str(err)
