"""A2A (Agent2Agent) protocol — open protocol for cross-agent communication.

Google's A2A protocol (https://github.com/a2aproject/A2A) lets opaque
agent applications talk to each other over HTTP. Kairo's
:mod:`kairo.agent.coord` module provides an *in-process* bus; this
module adds an HTTP transport so Kairo agents can participate in
cross-process A2A networks.

Protocol summary (simplified):
  * Agents are addressed by URL: ``http://host:port/agents/{name}``
  * Clients POST a JSON-RPC request to send a message.
  * Servers respond with the agent's reply.
  * Agents expose ``/agent-card`` describing their capabilities.

This module provides:
  * :class:`A2AServer` — hosts Kairo agents over HTTP.
  * :class:`A2AClient` — sends A2A messages to remote agents.
  * :func:`agent_card` — builds an agent card (capability advertisement).

We don't implement the *full* A2A spec — just enough to interop with
other Kairo instances and any A2A-compliant client. For the full spec
see the A2A GitHub repo.
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable
from urllib.parse import urlparse

from kairo.utils import get_logger

log = get_logger("agent.a2a")


@dataclass(slots=True)
class AgentCard:
    """Capability advertisement for an A2A agent."""

    name: str
    description: str
    url: str
    version: str = "0.1.0"
    capabilities: list[str] = field(default_factory=list)
    skills: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "url": self.url,
            "version": self.version,
            "capabilities": self.capabilities,
            "skills": self.skills,
        }


@dataclass(slots=True)
class A2AMessage:
    """An A2A message envelope."""

    sender: str
    recipient: str  # agent URL or name
    content: str
    message_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    conversation_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "sender": self.sender,
            "recipient": self.recipient,
            "content": self.content,
            "message_id": self.message_id,
            "conversation_id": self.conversation_id,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "A2AMessage":
        return cls(
            sender=d.get("sender", ""),
            recipient=d.get("recipient", ""),
            content=d.get("content", ""),
            message_id=d.get("message_id", uuid.uuid4().hex[:16]),
            conversation_id=d.get("conversation_id"),
            metadata=d.get("metadata", {}) or {},
        )


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

class A2AServer:
    """Hosts Kairo agents over HTTP for cross-process A2A.

    Each registered agent is a callable that takes an :class:`A2AMessage`
    and returns a response :class:`A2AMessage`. The server handles the
    HTTP transport — agents just need to implement the message handler.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 0) -> None:
        self.host = host
        self.port = port
        self._agents: dict[str, AgentCard] = {}
        self._handlers: dict[str, Callable[[A2AMessage], A2AMessage]] = {}
        self._lock = threading.RLock()
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None

    def register(
        self,
        card: AgentCard,
        handler: Callable[[A2AMessage], A2AMessage],
    ) -> None:
        with self._lock:
            self._agents[card.name] = card
            self._handlers[card.name] = handler

    def start(self) -> str:
        """Start the server. Returns the base URL."""
        if self._server is not None:
            return f"http://{self.host}:{self.port}"
        server_ref = self

        class _Handler(BaseHTTPRequestHandler):
            def _send_json(self, code: int, body: Any) -> None:
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

            def do_GET(self) -> None:
                path = urlparse(self.path).path
                if path == "/.well-known/agent-cards":
                    self._send_json(200, [c.to_dict() for c in server_ref._agents.values()])
                    return
                if path.startswith("/agents/"):
                    name = path[len("/agents/"):]
                    with server_ref._lock:
                        card = server_ref._agents.get(name)
                    if card is None:
                        self._send_json(404, {"error": "unknown agent"})
                        return
                    self._send_json(200, card.to_dict())
                    return
                self._send_json(404, {"error": "not found"})

            def do_POST(self) -> None:
                path = urlparse(self.path).path
                if not path.startswith("/agents/"):
                    self._send_json(404, {"error": "not found"})
                    return
                name = path[len("/agents/"):]
                with server_ref._lock:
                    handler = server_ref._handlers.get(name)
                if handler is None:
                    self._send_json(404, {"error": "unknown agent"})
                    return
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length else "{}"
                try:
                    msg = A2AMessage.from_dict(json.loads(body))
                except json.JSONDecodeError as exc:
                    self._send_json(400, {"error": f"invalid JSON: {exc}"})
                    return
                try:
                    reply = handler(msg)
                except Exception as exc:  # noqa: BLE001
                    self._send_json(500, {"error": str(exc)})
                    return
                self._send_json(200, reply.to_dict())

            def log_message(self, fmt, *args) -> None:
                pass  # silence

        if self.port == 0:
            # Find a free port.
            import socket
            with socket.socket() as s:
                s.bind((self.host, 0))
                self.port = s.getsockname()[1]
        self._server = HTTPServer((self.host, self.port), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        log.info("A2A server listening on http://%s:%s", self.host, self.port)
        return f"http://{self.host}:{self.port}"

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def url_for(self, agent_name: str) -> str:
        return f"http://{self.host}:{self.port}/agents/{agent_name}"


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class A2AClient:
    """Sends A2A messages to remote agents."""

    def __init__(self, sender_name: str = "kairo-client") -> None:
        self.sender_name = sender_name

    def send(self, recipient_url: str, content: str, **metadata: Any) -> A2AMessage:
        """POST a message to ``recipient_url``. Returns the reply."""
        import httpx
        msg = A2AMessage(
            sender=self.sender_name,
            recipient=recipient_url,
            content=content,
            metadata=metadata,
        )
        try:
            with httpx.Client(timeout=60.0) as c:
                resp = c.post(recipient_url, json=msg.to_dict())
        except httpx.HTTPError as exc:
            raise RuntimeError(f"A2A request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise RuntimeError(f"A2A error {resp.status_code}: {resp.text[:200]}")
        return A2AMessage.from_dict(resp.json())

    def get_card(self, base_url: str, agent_name: str) -> AgentCard:
        """Fetch an agent's card."""
        import httpx
        url = f"{base_url.rstrip('/')}/agents/{agent_name}"
        with httpx.Client(timeout=10.0) as c:
            resp = c.get(url)
        if resp.status_code >= 400:
            raise RuntimeError(f"failed to fetch card: {resp.status_code}")
        data = resp.json()
        return AgentCard(
            name=data["name"],
            description=data.get("description", ""),
            url=data.get("url", url),
            version=data.get("version", "0.1.0"),
            capabilities=data.get("capabilities", []),
            skills=data.get("skills", []),
        )

    def list_agents(self, base_url: str) -> list[AgentCard]:
        """List all agents advertised by a server."""
        import httpx
        url = f"{base_url.rstrip('/')}/.well-known/agent-cards"
        with httpx.Client(timeout=10.0) as c:
            resp = c.get(url)
        if resp.status_code >= 400:
            raise RuntimeError(f"failed to list agents: {resp.status_code}")
        data = resp.json()
        return [
            AgentCard(
                name=d["name"],
                description=d.get("description", ""),
                url=d.get("url", ""),
                version=d.get("version", "0.1.0"),
                capabilities=d.get("capabilities", []),
                skills=d.get("skills", []),
            )
            for d in data
        ]
