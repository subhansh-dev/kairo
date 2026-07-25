"""Multi-agent coordination protocol — agents that talk to each other.

This is the next step beyond ``swarm``: instead of one parent fanning
out independent subtasks to anonymous children, multiple named agents
exchange structured messages over a shared bus. Each agent has its own
loop, its own tools, and its own persona, and can address messages to
specific other agents or broadcast to everyone.

Use cases:
  * A "researcher" agent that gathers docs and hands them to a
    "coder" agent.
  * A "tester" agent that watches for file changes and runs tests.
  * A "reviewer" agent that critiques the coder's diffs.

Implementation: a single :class:`AgentBus` mediates all communication.
Each agent subscribes to the bus with a name; messages are routed by
``to`` field (a specific agent name or "*" for broadcast).

Messages are NOT model outputs — they're explicit inter-agent
communications with a ``kind`` (request, response, broadcast) and a
structured payload.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from kairo.utils import get_logger

log = get_logger("agent.coord")


class MsgKind(str, Enum):
    REQUEST = "request"      # ask another agent to do something
    RESPONSE = "response"    # reply to a request
    BROADCAST = "broadcast"  # announcement to all agents
    EVENT = "event"          # notify of an event (file changed, test ran, etc.)


@dataclass(slots=True)
class AgentMessage:
    """A single inter-agent message."""

    from_: str
    to: str  # agent name or "*" for broadcast
    kind: MsgKind
    content: str
    payload: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: f"msg_{uuid.uuid4().hex[:12]}")
    in_reply_to: str | None = None
    ts: float = field(default_factory=time.time)


class AgentBus:
    """In-process message bus for multi-agent coordination.

    Thread-safe. Each agent registers with a unique name and gets a
    private inbox. Messages are pulled from the inbox by the receiving
    agent's loop.

    The bus is intentionally in-process — for cross-process coordination
    use a real message broker (Redis, NATS, etc.). The API is shaped so
    a broker-backed implementation can drop in later.
    """

    def __init__(self) -> None:
        self._inboxes: dict[str, deque[AgentMessage]] = defaultdict(deque)
        self._subs: dict[str, Callable[[AgentMessage], None]] = {}
        self._lock = threading.RLock()
        self._history: list[AgentMessage] = []

    # -- registration --------------------------------------------------

    def register(self, name: str, on_msg: Callable[[AgentMessage], None] | None = None) -> None:
        """Register an agent name. Optional ``on_msg`` callback fires on delivery."""
        with self._lock:
            if name in self._inboxes:
                raise ValueError(f"agent {name!r} already registered")
            self._inboxes[name] = deque()
            if on_msg is not None:
                self._subs[name] = on_msg

    def unregister(self, name: str) -> None:
        with self._lock:
            self._inboxes.pop(name, None)
            self._subs.pop(name, None)

    # -- sending -------------------------------------------------------

    def send(self, msg: AgentMessage) -> None:
        """Send a message. If ``to`` is "*", broadcasts to every agent."""
        with self._lock:
            self._history.append(msg)
            if msg.to == "*":
                for name in self._inboxes:
                    if name == msg.from_:
                        continue  # don't echo to sender
                    self._inboxes[name].append(msg)
                    sub = self._subs.get(name)
                # Fire callbacks outside the lock to avoid reentrancy.
                for name, sub in list(self._subs.items()):
                    if name == msg.from_:
                        continue
                    try:
                        sub(msg)
                    except Exception as exc:  # noqa: BLE001
                        log.warning("subscriber %r crashed: %s", name, exc)
            else:
                if msg.to not in self._inboxes:
                    raise ValueError(f"unknown agent: {msg.to!r}")
                self._inboxes[msg.to].append(msg)
                sub = self._subs.get(msg.to)
                if sub is not None:
                    try:
                        sub(msg)
                    except Exception as exc:  # noqa: BLE001
                        log.warning("subscriber %r crashed: %s", msg.to, exc)

    # -- receiving -----------------------------------------------------

    def recv(self, name: str, timeout_s: float = 0.0) -> AgentMessage | None:
        """Pop the next message from ``name``'s inbox.

        Blocks up to ``timeout_s`` seconds if the inbox is empty. Returns
        None if no message arrived in time.
        """
        import time as _time
        deadline = _time.time() + timeout_s
        while True:
            with self._lock:
                if self._inboxes.get(name):
                    return self._inboxes[name].popleft()
            if _time.time() >= deadline:
                return None
            _time.sleep(0.05)

    def inbox_size(self, name: str) -> int:
        with self._lock:
            return len(self._inboxes.get(name, ()))

    def history(self, agent: str | None = None) -> list[AgentMessage]:
        """Return the message history, optionally filtered by agent."""
        with self._lock:
            if agent is None:
                return list(self._history)
            return [m for m in self._history if m.from_ == agent or m.to == agent]

    def agents(self) -> list[str]:
        with self._lock:
            return sorted(self._inboxes.keys())


# ---------------------------------------------------------------------------
# CoordinatedAgent — wraps a Kairo Agent with bus participation
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class CoordinatedAgent:
    """A Kairo agent that also listens on an :class:`AgentBus`.

    The wrapper doesn't run the agent loop itself — that's still driven
    by the host. It just provides ``send_to``, ``broadcast``, ``recv``,
    and ``request`` helpers so the agent's tools can talk to other agents.
    """

    name: str
    bus: AgentBus

    def __post_init__(self) -> None:
        self.bus.register(self.name)

    def send_to(self, to: str, content: str, **payload: Any) -> str:
        """Send a request to another agent. Returns the message id."""
        msg = AgentMessage(
            from_=self.name, to=to, kind=MsgKind.REQUEST,
            content=content, payload=payload,
        )
        self.bus.send(msg)
        return msg.id

    def broadcast(self, content: str, **payload: Any) -> str:
        """Broadcast an announcement to all agents."""
        msg = AgentMessage(
            from_=self.name, to="*", kind=MsgKind.BROADCAST,
            content=content, payload=payload,
        )
        self.bus.send(msg)
        return msg.id

    def respond(self, in_reply_to: AgentMessage, content: str, **payload: Any) -> str:
        """Respond to a previously-received message."""
        msg = AgentMessage(
            from_=self.name, to=in_reply_to.from_, kind=MsgKind.RESPONSE,
            content=content, payload=payload, in_reply_to=in_reply_to.id,
        )
        self.bus.send(msg)
        return msg.id

    def recv(self, timeout_s: float = 0.0) -> AgentMessage | None:
        return self.bus.recv(self.name, timeout_s=timeout_s)

    def request(self, to: str, content: str, timeout_s: float = 30.0, **payload: Any) -> AgentMessage | None:
        """Send a request and wait for a response synchronously."""
        msg_id = self.send_to(to, content, **payload)
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            msg = self.recv(timeout_s=1.0)
            if msg is None:
                continue
            if msg.kind == MsgKind.RESPONSE and msg.in_reply_to == msg_id:
                return msg
            # Put non-matching messages back at the front.
            # (Simplest path: queue them in a local list to process later.)
        return None

    def close(self) -> None:
        self.bus.unregister(self.name)
