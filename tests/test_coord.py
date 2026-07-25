"""Tests for kairo.agent.coord — multi-agent message bus."""

from __future__ import annotations

import time

import pytest

from kairo.agent.coord import (
    AgentBus,
    AgentMessage,
    CoordinatedAgent,
    MsgKind,
)


def test_bus_register_and_send():
    bus = AgentBus()
    bus.register("alice")
    bus.register("bob")
    msg = AgentMessage(from_="alice", to="bob", kind=MsgKind.REQUEST, content="hi")
    bus.send(msg)
    received = bus.recv("bob")
    assert received is not None
    assert received.content == "hi"
    assert received.from_ == "alice"


def test_bus_send_to_unknown_agent_raises():
    bus = AgentBus()
    bus.register("alice")
    msg = AgentMessage(from_="alice", to="bogus", kind=MsgKind.REQUEST, content="hi")
    with pytest.raises(ValueError):
        bus.send(msg)


def test_bus_broadcast_reaches_all_except_sender():
    bus = AgentBus()
    bus.register("alice")
    bus.register("bob")
    bus.register("carol")
    bus.send(AgentMessage(from_="alice", to="*", kind=MsgKind.BROADCAST, content="hey"))
    # alice should NOT have received her own broadcast.
    assert bus.inbox_size("alice") == 0
    # bob and carol should each have one.
    assert bus.inbox_size("bob") == 1
    assert bus.inbox_size("carol") == 1


def test_bus_recv_empty_returns_none():
    bus = AgentBus()
    bus.register("alice")
    received = bus.recv("alice", timeout_s=0.1)
    assert received is None


def test_bus_history():
    bus = AgentBus()
    bus.register("alice")
    bus.register("bob")
    bus.send(AgentMessage(from_="alice", to="bob", kind=MsgKind.REQUEST, content="hi"))
    bus.send(AgentMessage(from_="bob", to="alice", kind=MsgKind.RESPONSE, content="yo"))
    history = bus.history()
    assert len(history) == 2
    # Filter by agent.
    alice_msgs = bus.history("alice")
    assert len(alice_msgs) == 2  # alice sent one and received one


def test_bus_callback_fires():
    bus = AgentBus()
    received: list[AgentMessage] = []
    bus.register("alice", on_msg=lambda m: received.append(m))
    bus.register("bob")
    bus.send(AgentMessage(from_="bob", to="alice", kind=MsgKind.REQUEST, content="hi"))
    # The callback should have been called synchronously.
    assert len(received) == 1
    assert received[0].content == "hi"


def test_bus_register_duplicate_raises():
    bus = AgentBus()
    bus.register("alice")
    with pytest.raises(ValueError):
        bus.register("alice")


def test_coordinated_agent_send_and_recv():
    bus = AgentBus()
    alice = CoordinatedAgent(name="alice", bus=bus)
    bob = CoordinatedAgent(name="bob", bus=bus)
    alice.send_to("bob", "hello")
    msg = bob.recv(timeout_s=1.0)
    assert msg is not None
    assert msg.content == "hello"
    bob.respond(msg, "hi back")
    reply = alice.recv(timeout_s=1.0)
    assert reply is not None
    assert reply.content == "hi back"
    assert reply.in_reply_to == msg.id


def test_coordinated_agent_broadcast():
    bus = AgentBus()
    alice = CoordinatedAgent(name="alice", bus=bus)
    bob = CoordinatedAgent(name="bob", bus=bus)
    carol = CoordinatedAgent(name="carol", bus=bus)
    alice.broadcast("announcement")
    assert bob.recv(timeout_s=0.5) is not None
    assert carol.recv(timeout_s=0.5) is not None
    assert alice.recv(timeout_s=0.5) is None  # no echo


def test_coordinated_agent_request_synchronous():
    bus = AgentBus()
    alice = CoordinatedAgent(name="alice", bus=bus)
    bob = CoordinatedAgent(name="bob", bus=bus)

    # Bob runs a background thread that responds to requests.
    import threading
    def bob_loop():
        msg = bob.recv(timeout_s=5.0)
        if msg and msg.kind == MsgKind.REQUEST:
            bob.respond(msg, "here's your answer")

    t = threading.Thread(target=bob_loop, daemon=True)
    t.start()

    reply = alice.request("bob", "what's the answer?", timeout_s=3.0)
    assert reply is not None
    assert "answer" in reply.content


def test_coordinated_agent_request_timeout():
    bus = AgentBus()
    alice = CoordinatedAgent(name="alice", bus=bus)
    bob = CoordinatedAgent(name="bob", bus=bus)
    # Nobody responds.
    reply = alice.request("bob", "hello?", timeout_s=0.5)
    assert reply is None
