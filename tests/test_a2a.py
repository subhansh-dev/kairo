"""Tests for kairo.agent.a2a — Agent2Agent protocol server + client."""

from __future__ import annotations

import socket
import time

import pytest

from kairo.agent.a2a import A2AClient, A2AMessage, A2AServer, AgentCard


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_agent_card_to_dict():
    card = AgentCard(
        name="alice", description="test agent",
        url="http://localhost:8000/agents/alice",
        capabilities=["code", "search"],
    )
    d = card.to_dict()
    assert d["name"] == "alice"
    assert d["capabilities"] == ["code", "search"]


def test_a2a_message_to_from_dict():
    msg = A2AMessage(sender="alice", recipient="bob", content="hello")
    d = msg.to_dict()
    msg2 = A2AMessage.from_dict(d)
    assert msg2.sender == "alice"
    assert msg2.recipient == "bob"
    assert msg2.content == "hello"
    assert msg2.message_id == msg.message_id


def test_a2a_server_starts_and_stops():
    port = _free_port()
    server = A2AServer(host="127.0.0.1", port=port)
    url = server.start()
    assert f"127.0.0.1:{port}" in url
    server.stop()


def test_a2a_server_lists_agents():
    port = _free_port()
    server = A2AServer(host="127.0.0.1", port=port)
    server.register(
        AgentCard(name="alice", description="A", url=f"http://127.0.0.1:{port}/agents/alice"),
        handler=lambda m: A2AMessage(sender="alice", recipient=m.sender, content="hi"),
    )
    server.start()
    try:
        client = A2AClient(sender_name="test-client")
        agents = client.list_agents(f"http://127.0.0.1:{port}")
        assert len(agents) == 1
        assert agents[0].name == "alice"
    finally:
        server.stop()


def test_a2a_server_get_card():
    port = _free_port()
    server = A2AServer(host="127.0.0.1", port=port)
    server.register(
        AgentCard(name="alice", description="Test agent", url="",
                  capabilities=["code"]),
        handler=lambda m: A2AMessage(sender="alice", recipient=m.sender, content="hi"),
    )
    server.start()
    try:
        client = A2AClient(sender_name="test-client")
        card = client.get_card(f"http://127.0.0.1:{port}", "alice")
        assert card.name == "alice"
        assert "code" in card.capabilities
    finally:
        server.stop()


def test_a2a_server_unknown_agent_returns_404():
    port = _free_port()
    server = A2AServer(host="127.0.0.1", port=port)
    server.start()
    try:
        client = A2AClient(sender_name="test-client")
        with pytest.raises(RuntimeError, match="404"):
            client.get_card(f"http://127.0.0.1:{port}", "nope")
    finally:
        server.stop()


def test_a2a_send_message_round_trip():
    port = _free_port()
    server = A2AServer(host="127.0.0.1", port=port)

    def handler(msg: A2AMessage) -> A2AMessage:
        return A2AMessage(
            sender="alice", recipient=msg.sender,
            content=f"echo: {msg.content}",
        )

    server.register(
        AgentCard(name="alice", description="echo agent", url=""),
        handler=handler,
    )
    server.start()
    try:
        client = A2AClient(sender_name="test-client")
        reply = client.send(
            f"http://127.0.0.1:{port}/agents/alice",
            "hello",
        )
        assert reply.content == "echo: hello"
        assert reply.sender == "alice"
    finally:
        server.stop()


def test_a2a_handler_exception_returns_500():
    port = _free_port()
    server = A2AServer(host="127.0.0.1", port=port)

    def bad_handler(msg: A2AMessage) -> A2AMessage:
        raise RuntimeError("boom")

    server.register(
        AgentCard(name="alice", description="", url=""),
        handler=bad_handler,
    )
    server.start()
    try:
        client = A2AClient(sender_name="test-client")
        with pytest.raises(RuntimeError, match="500"):
            client.send(f"http://127.0.0.1:{port}/agents/alice", "hi")
    finally:
        server.stop()
