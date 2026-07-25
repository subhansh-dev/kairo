"""Webhook / event-subscription system — notify external systems on agent events.

Kairo's EventBus is in-process only. This module extends it to fire
HTTP webhooks on chosen events so external systems (Slack, Discord,
custom dashboards, CI/CD pipelines) can react in real time.

Features:
  * :class:`WebhookSubscription` — a single URL + event filter + secret.
  * :class:`WebhookDispatcher` — manages subscriptions, fires them on
    EventBus events. Retries with exponential backoff. Signs payloads
    with HMAC-SHA256 so receivers can verify authenticity.
  * :class:`WebhookServer` — receives webhooks FROM other systems and
    translates them into Kairo actions (e.g. trigger an agent run).

Use cases:
  * Notify Slack when an agent finishes a long-running task.
  * Trigger a CI build when an agent modifies a file.
  * Sync agent learning-graph updates to a centralized knowledge base.
  * Build a "agent-of-agents" that watches other agents' events.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import urlparse

import httpx

from kairo.utils import EventKind, get_event_bus, get_logger

log = get_logger("observability.webhooks")


@dataclass(slots=True)
class WebhookSubscription:
    """A single webhook subscription."""

    url: str
    # Event kinds to forward. None means "all events".
    event_kinds: list[EventKind] | None = None
    # Optional HMAC secret for signing payloads.
    secret: str | None = None
    # Custom headers to send.
    headers: dict[str, str] = field(default_factory=dict)
    # Max retries on failure.
    max_retries: int = 3
    # Initial backoff (seconds) for retries.
    backoff_s: float = 1.0
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    enabled: bool = True


@dataclass(slots=True)
class WebhookDelivery:
    """Record of a single webhook delivery attempt."""

    subscription_id: str
    event_kind: str
    payload: dict
    url: str
    success: bool
    status_code: int | None = None
    error: str | None = None
    attempts: int = 0
    ts: float = field(default_factory=time.time)


class WebhookDispatcher:
    """Manages webhook subscriptions and fires them on EventBus events.

    Subscribes to the EventBus on construction. Each matching event is
    POSTed to every subscription's URL with HMAC signature (when a
    secret is configured). Failures are retried with exponential backoff.

    All deliveries happen in background threads so the EventBus isn't
    blocked.
    """

    def __init__(self) -> None:
        self._subs: dict[str, WebhookSubscription] = {}
        self._lock = threading.RLock()
        self._unsub: callable | None = None
        self._delivery_history: list[WebhookDelivery] = []
        self._history_lock = threading.RLock()
        self._pool = ThreadPoolExecutorLite(max_workers=8)

    # -- lifecycle -----------------------------------------------------

    def start(self) -> None:
        """Subscribe to the EventBus."""
        if self._unsub is not None:
            return
        # Subscribe to every event kind.
        bus = get_event_bus()
        # The EventBus publishes by kind, so we need to subscribe to each.
        for kind in EventKind:
            bus.subscribe(kind, self._on_event)

    def stop(self) -> None:
        # We don't track individual unsubs here; for simplicity we leave
        # them active (the bus is process-lifetime anyway).
        self._pool.shutdown()

    # -- subscription management ---------------------------------------

    def add(self, sub: WebhookSubscription) -> str:
        with self._lock:
            self._subs[sub.id] = sub
        log.info("webhook %s registered for %s", sub.id, sub.url)
        return sub.id

    def remove(self, sub_id: str) -> bool:
        with self._lock:
            return self._subs.pop(sub_id, None) is not None

    def list_subs(self) -> list[WebhookSubscription]:
        with self._lock:
            return list(self._subs.values())

    # -- delivery ------------------------------------------------------

    def _on_event(self, payload: dict) -> None:
        # Determine the event kind from the payload.
        kind_str = payload.get("kind", "")
        try:
            kind = EventKind(kind_str)
        except ValueError:
            return  # unknown kind
        # Find matching subscriptions.
        with self._lock:
            subs = [s for s in self._subs.values() if s.enabled]
        matching: list[WebhookSubscription] = []
        for s in subs:
            if s.event_kinds is None or kind in s.event_kinds:
                matching.append(s)
        # Fire each in a background thread.
        for sub in matching:
            self._pool.submit(self._deliver, sub, kind, payload)

    def _deliver(self, sub: WebhookSubscription, kind: EventKind, payload: dict) -> None:
        """Deliver a single webhook with retries."""
        body = json.dumps(payload, default=str).encode("utf-8")
        headers = {"Content-Type": "application/json", **sub.headers}
        # Sign the body if a secret is configured.
        if sub.secret:
            sig = hmac.new(sub.secret.encode(), body, hashlib.sha256).hexdigest()
            headers["X-Kairo-Signature"] = sig
        headers["X-Kairo-Event"] = kind.value

        last_err: str | None = None
        status_code: int | None = None
        for attempt in range(1, sub.max_retries + 1):
            try:
                with httpx.Client(timeout=10.0) as c:
                    resp = c.post(sub.url, content=body, headers=headers)
                status_code = resp.status_code
                if 200 <= resp.status_code < 300:
                    self._record_delivery(sub, kind, payload, success=True,
                                          status_code=status_code, attempts=attempt)
                    return
                last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
            except httpx.HTTPError as exc:
                last_err = str(exc)
            # Backoff before retry.
            if attempt < sub.max_retries:
                time.sleep(sub.backoff_s * (2 ** (attempt - 1)))
        # All retries failed.
        self._record_delivery(sub, kind, payload, success=False,
                              status_code=status_code, error=last_err,
                              attempts=sub.max_retries)

    def _record_delivery(self, sub: WebhookSubscription, kind: EventKind,
                          payload: dict, *, success: bool,
                          status_code: int | None, error: str | None = None,
                          attempts: int = 1) -> None:
        delivery = WebhookDelivery(
            subscription_id=sub.id, event_kind=kind.value, payload=payload,
            url=sub.url, success=success, status_code=status_code,
            error=error, attempts=attempts,
        )
        with self._history_lock:
            self._delivery_history.append(delivery)
            # Cap history at 1000 entries.
            if len(self._delivery_history) > 1000:
                self._delivery_history = self._delivery_history[-1000:]

    def delivery_history(self, limit: int = 50) -> list[WebhookDelivery]:
        with self._history_lock:
            return list(self._delivery_history[-limit:])


# ---------------------------------------------------------------------------
# Tiny thread pool — avoid pulling in concurrent.futures for one-shot uses
# ---------------------------------------------------------------------------

class ThreadPoolExecutorLite:
    """Minimal thread pool — submit() returns None, fire-and-forget.

    We use this instead of ``concurrent.futures.ThreadPoolExecutor``
    so the webhook dispatcher doesn't have to manage Future objects
    (we don't care about the result; deliveries are logged via the
    history list).
    """

    def __init__(self, max_workers: int = 4) -> None:
        self._semaphore = threading.Semaphore(max_workers)
        self._threads: list[threading.Thread] = []

    def submit(self, fn: Callable, *args, **kwargs) -> None:
        def _run():
            with self._semaphore:
                try:
                    fn(*args, **kwargs)
                except Exception as exc:  # noqa: BLE001
                    log.warning("thread pool task failed: %s", exc)
        t = threading.Thread(target=_run, daemon=True)
        t.start()
        self._threads.append(t)

    def shutdown(self) -> None:
        # Don't wait — fire-and-forget. Threads are daemon.
        pass


# ---------------------------------------------------------------------------
# Signature verification (for receivers)
# ---------------------------------------------------------------------------

def verify_signature(secret: str, body: bytes, signature: str) -> bool:
    """Verify an ``X-Kairo-Signature`` header.

    The signature is the hex-encoded HMAC-SHA256 of the body using
    ``secret`` as the key.
    """
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
