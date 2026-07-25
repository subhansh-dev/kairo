"""Tests for kairo.observability.webhooks — webhook subscription + delivery."""

from __future__ import annotations

import hashlib
import hmac
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

import pytest

from kairo.observability.webhooks import (
    WebhookDelivery,
    WebhookDispatcher,
    WebhookSubscription,
    verify_signature,
)
from kairo.utils import EventKind, get_event_bus


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _RecordingServer:
    """Tiny HTTP server that records POST bodies for assertions."""

    def __init__(self, port: int) -> None:
        self.port = port
        self.received: list[tuple[dict, dict]] = []  # (headers, body)
        self._lock = threading.Lock()
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> str:
        server_ref = self

        class _Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length else "{}"
                try:
                    body_json = json.loads(body)
                except json.JSONDecodeError:
                    body_json = {"_raw": body}
                headers = {k: v for k, v in self.headers.items()}
                with server_ref._lock:
                    server_ref.received.append((headers, body_json))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"ok": true}')

            def log_message(self, fmt, *args) -> None:
                pass

        self._server = HTTPServer(("127.0.0.1", self.port), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return f"http://127.0.0.1:{self.port}"

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server = None
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None


def test_verify_signature_valid():
    secret = "test-secret"
    body = b'{"hello": "world"}'
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert verify_signature(secret, body, sig) is True


def test_verify_signature_invalid():
    assert verify_signature("secret", b"body", "bogus-signature") is False


def test_verify_signature_wrong_secret():
    body = b"body"
    sig = hmac.new(b"correct", body, hashlib.sha256).hexdigest()
    assert verify_signature("wrong", body, sig) is False


def test_webhook_subscription_defaults():
    sub = WebhookSubscription(url="http://example.com/hook")
    assert sub.event_kinds is None  # all events
    assert sub.max_retries == 3
    assert sub.backoff_s == 1.0
    assert sub.enabled is True
    assert sub.id  # auto-generated


def test_dispatcher_add_and_list_subs():
    d = WebhookDispatcher()
    sub1 = WebhookSubscription(url="http://example.com/1")
    sub2 = WebhookSubscription(url="http://example.com/2")
    d.add(sub1)
    d.add(sub2)
    subs = d.list_subs()
    assert len(subs) == 2
    assert {s.url for s in subs} == {"http://example.com/1", "http://example.com/2"}


def test_dispatcher_remove_sub():
    d = WebhookDispatcher()
    sub = WebhookSubscription(url="http://example.com")
    sub_id = d.add(sub)
    assert d.remove(sub_id) is True
    assert d.remove(sub_id) is False
    assert d.list_subs() == []


def test_dispatcher_delivers_to_real_server():
    port = _free_port()
    server = _RecordingServer(port)
    server.start()
    try:
        d = WebhookDispatcher()
        sub = WebhookSubscription(url=f"http://127.0.0.1:{port}/hook",
                                   event_kinds=[EventKind.AGENT_END],
                                   max_retries=1, backoff_s=0)
        d.add(sub)
        d.start()
        # Publish an event.
        get_event_bus().publish(EventKind.AGENT_END, {
            "kind": EventKind.AGENT_END.value,
            "finish_reason": "complete",
            "ts": time.time(),
        })
        # Wait for delivery (background thread).
        for _ in range(20):
            time.sleep(0.1)
            with server._lock:
                if server.received:
                    break
        assert len(server.received) >= 1
        headers, body = server.received[0]
        assert headers.get("X-Kairo-Event") == "agent.end"
        assert body.get("finish_reason") == "complete"
        # Check delivery history.
        history = d.delivery_history()
        assert len(history) >= 1
        assert history[0].success is True
    finally:
        server.stop()


def test_dispatcher_signs_payload_when_secret_set():
    port = _free_port()
    server = _RecordingServer(port)
    server.start()
    try:
        secret = "test-secret-123"
        d = WebhookDispatcher()
        sub = WebhookSubscription(
            url=f"http://127.0.0.1:{port}/hook",
            event_kinds=[EventKind.AGENT_END],
            secret=secret,
            max_retries=1, backoff_s=0,
        )
        d.add(sub)
        d.start()
        get_event_bus().publish(EventKind.AGENT_END, {
            "kind": EventKind.AGENT_END.value,
            "finish_reason": "complete",
            "ts": time.time(),
        })
        # Wait for delivery.
        for _ in range(20):
            time.sleep(0.1)
            with server._lock:
                if server.received:
                    break
        assert len(server.received) >= 1
        headers, body = server.received[0]
        sig = headers.get("X-Kairo-Signature")
        assert sig is not None
        # Verify the signature matches.
        body_bytes = json.dumps(body, default=str).encode()
        assert verify_signature(secret, body_bytes, sig) is True
    finally:
        server.stop()


def test_dispatcher_filters_by_event_kind():
    port = _free_port()
    server = _RecordingServer(port)
    server.start()
    try:
        d = WebhookDispatcher()
        sub = WebhookSubscription(
            url=f"http://127.0.0.1:{port}/hook",
            event_kinds=[EventKind.AGENT_END],  # only agent_end events
            max_retries=1, backoff_s=0,
        )
        d.add(sub)
        d.start()
        # Publish a TOOL_CALL event — should NOT be delivered.
        get_event_bus().publish(EventKind.TOOL_CALL, {
            "kind": EventKind.TOOL_CALL.value, "name": "read_file",
            "ts": time.time(),
        })
        # Wait briefly.
        time.sleep(0.3)
        assert len(server.received) == 0
        # Now publish an AGENT_END — should be delivered.
        get_event_bus().publish(EventKind.AGENT_END, {
            "kind": EventKind.AGENT_END.value, "finish_reason": "complete",
            "ts": time.time(),
        })
        for _ in range(20):
            time.sleep(0.1)
            with server._lock:
                if server.received:
                    break
        assert len(server.received) == 1
    finally:
        server.stop()


def test_dispatcher_disabled_sub_not_delivered():
    port = _free_port()
    server = _RecordingServer(port)
    server.start()
    try:
        d = WebhookDispatcher()
        sub = WebhookSubscription(
            url=f"http://127.0.0.1:{port}/hook",
            event_kinds=[EventKind.AGENT_END],
            enabled=False,
            max_retries=1, backoff_s=0,
        )
        d.add(sub)
        d.start()
        get_event_bus().publish(EventKind.AGENT_END, {
            "kind": EventKind.AGENT_END.value, "finish_reason": "complete",
            "ts": time.time(),
        })
        time.sleep(0.3)
        assert len(server.received) == 0
    finally:
        server.stop()


def test_dispatcher_history_capped_at_1000():
    d = WebhookDispatcher()
    # Use _record_delivery so the cap kicks in.
    sub = WebhookSubscription(url="http://x")
    for i in range(1100):
        d._record_delivery(sub, EventKind.AGENT_END, {"i": i}, success=True,
                           status_code=200, attempts=1)
    history = d.delivery_history(limit=2000)
    assert len(history) == 1000  # capped
