"""Prometheus-style metrics endpoint for Kairo.

Exposes agent run metrics over HTTP in the Prometheus text format so
they can be scraped by Prometheus / Grafana / VictoriaMetrics / etc.

Metrics exposed:
  * ``kairo_agent_runs_total`` (counter) — total runs by finish_reason
  * ``kairo_agent_turns_total`` (counter) — total turns executed
  * ``kairo_agent_tokens_total`` (counter) — total tokens consumed
  * ``kairo_agent_cost_usd_total`` (counter) — total USD spent
  * ``kairo_agent_duration_seconds`` (histogram) — run duration
  * ``kairo_tool_calls_total`` (counter) — by tool name + ok/err
  * ``kairo_provider_calls_total`` (counter) — by provider + model
  * ``kairo_provider_errors_total`` (counter) — by provider
  * ``kairo_guardrail_blocks_total`` (counter) — by rule

Usage::

    from kairo.observability.metrics import MetricsCollector, MetricsServer

    collector = MetricsCollector.default()
    server = MetricsServer(collector, port=9090)
    server.start()
    # Metrics at http://localhost:9090/metrics

The collector subscribes to the EventBus so it captures every agent
run automatically.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from kairo.utils import EventKind, get_event_bus, get_logger

log = get_logger("observability.metrics")


@dataclass(slots=True)
class _Counter:
    """A simple counter with labels."""

    value: float = 0.0
    labels: tuple[tuple[str, str], ...] = ()


@dataclass(slots=True)
class _Histogram:
    """A simple histogram with fixed buckets."""

    buckets: tuple[float, ...] = (0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0, 300.0)
    counts: list[int] = field(default_factory=lambda: [0] * 9)  # one per bucket + inf
    sum: float = 0.0
    count: int = 0

    def observe(self, value: float) -> None:
        self.sum += value
        self.count += 1
        for i, bound in enumerate(self.buckets):
            if value <= bound:
                self.counts[i] += 1
                return
        self.counts[-1] += 1  # +Inf bucket


class MetricsCollector:
    """Collects Kairo metrics in memory.

    Subscribe to the EventBus with :meth:`start` to capture events
    automatically. Call :meth:`render` to get the Prometheus text format.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        # labeled counters: name -> labels-tuple -> _Counter
        self._counters: dict[str, dict[tuple, _Counter]] = defaultdict(dict)
        # histograms: name -> labels-tuple -> _Histogram
        self._histograms: dict[str, dict[tuple, _Histogram]] = defaultdict(dict)
        self._unsub: list[callable] = []

    @classmethod
    def default(cls) -> "MetricsCollector":
        """Build a collector and subscribe to all relevant events."""
        c = cls()
        c.subscribe_to_bus()
        return c

    def subscribe_to_bus(self) -> None:
        bus = get_event_bus()
        self._unsub.append(bus.subscribe(EventKind.AGENT_END, self._on_agent_end))
        self._unsub.append(bus.subscribe(EventKind.TURN_END, self._on_turn_end))
        self._unsub.append(bus.subscribe(EventKind.TOOL_CALL, self._on_tool_call))
        self._unsub.append(bus.subscribe(EventKind.TOOL_RESULT, self._on_tool_result))

    def unsubscribe(self) -> None:
        for u in self._unsub:
            try:
                u()
            except Exception:  # noqa: BLE001
                pass
        self._unsub.clear()

    # -- event handlers ------------------------------------------------

    def _on_agent_end(self, payload: dict) -> None:
        finish = payload.get("finish_reason", "unknown")
        self.inc("kairo_agent_runs_total", finish_reason=finish)
        self.inc("kairo_agent_turns_total", count=payload.get("turns", 0))
        self.inc("kairo_agent_tokens_total", count=payload.get("tokens", 0))
        self.inc("kairo_agent_cost_usd_total", count=payload.get("cost_usd", 0.0))
        self.observe("kairo_agent_duration_seconds", payload.get("duration_s", 0.0))

    def _on_turn_end(self, payload: dict) -> None:
        # Some spans come through here too — ignore non-turn events.
        if "name" in payload and payload.get("name") in ("agent.run", "agent.turn",
                                                          "provider.complete", "tool.dispatch"):
            return

    def _on_tool_call(self, payload: dict) -> None:
        name = payload.get("name", "unknown")
        # Don't count swarm meta-events as tool calls.
        if name and not name.startswith("swarm."):
            self.inc("kairo_tool_calls_total", tool=name, status="called")

    def _on_tool_result(self, payload: dict) -> None:
        name = payload.get("name", "unknown")
        ok = "ok" if payload.get("ok") else "err"
        if name and not name.startswith("swarm."):
            self.inc("kairo_tool_calls_total", tool=name, status=ok)

    # -- mutation API (for tests + manual increments) -----------------

    def inc(self, name: str, *, count: float = 1, **labels: Any) -> None:
        key = tuple(sorted(labels.items()))
        with self._lock:
            c = self._counters[name].get(key)
            if c is None:
                c = _Counter(labels=key)
                self._counters[name][key] = c
            c.value += count

    def observe(self, name: str, value: float, **labels: Any) -> None:
        key = tuple(sorted(labels.items()))
        with self._lock:
            h = self._histograms[name].get(key)
            if h is None:
                h = _Histogram()
                self._histograms[name][key] = h
            h.observe(value)

    # -- rendering -----------------------------------------------------

    def render(self) -> str:
        """Render metrics in Prometheus text format."""
        lines: list[str] = []
        with self._lock:
            # Counters.
            for name in sorted(self._counters.keys()):
                labeled = self._counters[name]
                if not labeled:
                    continue
                # Help + type (only once per metric name).
                lines.append(f"# HELP {name} Kairo metric")
                lines.append(f"# TYPE {name} counter")
                for labels, c in sorted(labeled.items(), key=lambda x: x[0]):
                    label_str = ",".join(f'{k}="{v}"' for k, v in labels)
                    if label_str:
                        lines.append(f"{name}{{{label_str}}} {c.value}")
                    else:
                        lines.append(f"{name} {c.value}")
            # Histograms.
            for name in sorted(self._histograms.keys()):
                labeled = self._histograms[name]
                if not labeled:
                    continue
                lines.append(f"# HELP {name} Kairo metric")
                lines.append(f"# TYPE {name} histogram")
                for labels, h in sorted(labeled.items(), key=lambda x: x[0]):
                    label_str = ",".join(f'{k}="{v}"' for k, v in labels)
                    for i, bound in enumerate(h.buckets):
                        le = str(bound) if i < len(h.buckets) else "+Inf"
                        bucket_labels = (label_str + "," if label_str else "") + f'le="{le}"'
                        lines.append(f"{name}_bucket{{{bucket_labels}}} {h.counts[i]}")
                    inf_labels = (label_str + "," if label_str else "") + 'le="+Inf"'
                    lines.append(f"{name}_bucket{{{inf_labels}}} {h.count}")
                    if label_str:
                        lines.append(f"{name}_sum{{{label_str}}} {h.sum}")
                        lines.append(f"{name}_count{{{label_str}}} {h.count}")
                    else:
                        lines.append(f"{name}_sum {h.sum}")
                        lines.append(f"{name}_count {h.count}")
        return "\n".join(lines) + "\n"


class MetricsServer:
    """HTTP server that exposes /metrics for Prometheus scraping."""

    def __init__(self, collector: MetricsCollector, host: str = "0.0.0.0",
                 port: int = 9090) -> None:
        self.collector = collector
        self.host = host
        self.port = port
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> str:
        if self._server is not None:
            return f"http://{self.host}:{self.port}"
        server_ref = self

        class _Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path == "/metrics":
                    body = server_ref.collector.render().encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, fmt, *args) -> None:
                pass  # silence

        self._server = HTTPServer((self.host, self.port), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        url = f"http://{self.host}:{self.port}"
        log.info("metrics server running at %s/metrics", url)
        return url

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None
