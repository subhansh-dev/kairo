"""Tests for kairo.observability.metrics — Prometheus-style metrics."""

from __future__ import annotations

import socket
import urllib.request
from pathlib import Path

import pytest

from kairo.observability.metrics import MetricsCollector, MetricsServer


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_collector_inc_creates_counter():
    c = MetricsCollector()
    c.inc("test_counter", label="a")
    c.inc("test_counter", label="a")
    c.inc("test_counter", label="b")
    out = c.render()
    assert "test_counter" in out
    assert 'label="a"' in out
    assert 'label="b"' in out
    # Should have value 2 for label=a.
    assert 'test_counter{label="a"} 2' in out


def test_collector_observe_creates_histogram():
    c = MetricsCollector()
    c.observe("test_hist", 0.05)
    c.observe("test_hist", 1.5)
    c.observe("test_hist", 100.0)
    out = c.render()
    assert "test_hist" in out
    assert "# TYPE test_hist histogram" in out
    assert "test_hist_count" in out
    assert "test_hist_sum" in out
    # Bucket counts should be present.
    assert "test_hist_bucket" in out


def test_collector_render_empty():
    c = MetricsCollector()
    out = c.render()
    # Should be just a trailing newline.
    assert out == "\n"


def test_collector_with_labels_renders_correctly():
    c = MetricsCollector()
    c.inc("requests", method="GET", status="200")
    c.inc("requests", method="GET", status="200")
    c.inc("requests", method="POST", status="500")
    out = c.render()
    assert 'method="GET",status="200"' in out
    assert 'method="POST",status="500"' in out


def test_metrics_server_serves_metrics():
    port = _free_port()
    c = MetricsCollector()
    c.inc("test_metric", label="value")
    server = MetricsServer(c, host="127.0.0.1", port=port)
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics", timeout=3)
        body = resp.read().decode()
        assert "test_metric" in body
        assert 'label="value"' in body
    finally:
        server.stop()


def test_metrics_server_404_for_unknown_path():
    port = _free_port()
    c = MetricsCollector()
    server = MetricsServer(c, host="127.0.0.1", port=port)
    server.start()
    try:
        with pytest.raises(Exception):
            urllib.request.urlopen(f"http://127.0.0.1:{port}/nope", timeout=3)
    finally:
        server.stop()


def test_collector_default_subscribes_to_bus():
    """Default collector subscribes to the EventBus — verify it captures agent events."""
    from kairo.utils import EventKind, get_event_bus
    c = MetricsCollector.default()
    try:
        # Publish a fake agent_end event.
        get_event_bus().publish(EventKind.AGENT_END, {
            "kind": EventKind.AGENT_END.value,
            "finish_reason": "complete",
            "turns": 3,
            "tokens": 1000,
            "cost_usd": 0.05,
            "duration_s": 5.0,
            "ts": 12345.0,
        })
        out = c.render()
        assert "kairo_agent_runs_total" in out
        assert 'finish_reason="complete"' in out
        assert "kairo_agent_tokens_total" in out
        # Histogram should have observed the 5.0s duration.
        assert "kairo_agent_duration_seconds" in out
    finally:
        c.unsubscribe()


def test_collector_unsubscribe_stops_capture():
    from kairo.utils import EventKind, get_event_bus
    c = MetricsCollector.default()
    c.unsubscribe()
    # Publish after unsubscribe — should not be captured.
    get_event_bus().publish(EventKind.AGENT_END, {
        "kind": EventKind.AGENT_END.value,
        "finish_reason": "complete",
        "turns": 1, "tokens": 1, "cost_usd": 0.0, "duration_s": 1.0,
        "ts": 1.0,
    })
    out = c.render()
    assert "kairo_agent_runs_total" not in out


def test_collector_tool_call_events():
    from kairo.utils import EventKind, get_event_bus
    c = MetricsCollector.default()
    try:
        get_event_bus().publish(EventKind.TOOL_CALL, {
            "kind": EventKind.TOOL_CALL.value, "name": "read_file",
            "args": {}, "call_id": "c1", "ts": 1.0,
        })
        get_event_bus().publish(EventKind.TOOL_RESULT, {
            "kind": EventKind.TOOL_RESULT.value, "name": "read_file",
            "ok": True, "call_id": "c1", "duration_s": 0.1, "ts": 1.0,
        })
        out = c.render()
        assert "kairo_tool_calls_total" in out
        assert 'tool="read_file"' in out
        assert 'status="ok"' in out
    finally:
        c.unsubscribe()
