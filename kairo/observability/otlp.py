"""OpenTelemetry-style exporter — forward Kairo spans to OTLP.

Kairo's :mod:`kairo.tracing` module emits spans to the local EventBus.
This module subscribes to the bus and forwards each span to an OTLP
endpoint (e.g. a local Jaeger, Tempo, or Honeycomb collector).

The exporter uses the OpenTelemetry SDK when available. If the SDK
isn't installed, it falls back to a no-op so the rest of Kairo keeps
working.

Usage::

    from kairo.observability import OTLPExporter, OTLPConfig

    exporter = OTLPExporter(OTLPConfig(endpoint="http://localhost:4317"))
    exporter.start()
    # ... run agent ...
    exporter.stop()

Spans are batched and flushed on stop.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

from kairo.utils import EventKind, get_event_bus, get_logger

log = get_logger("observability.otlp")


@dataclass(slots=True)
class OTLPConfig:
    """OTLP exporter configuration."""

    endpoint: str = "http://localhost:4317"
    service_name: str = "kairo"
    service_version: str = "0.3.0"
    # Batch flush interval in seconds.
    flush_interval_s: float = 5.0
    # Max spans to buffer before forcing a flush.
    max_batch_size: int = 100


class OTLPExporter:
    """Exports Kairo spans to an OTLP collector.

    Requires the ``opentelemetry-sdk`` and ``opentelemetry-exporter-otlp``
    packages. Install with::

        pip install opentelemetry-sdk opentelemetry-exporter-otlp
    """

    def __init__(self, cfg: OTLPConfig | None = None) -> None:
        self.cfg = cfg or OTLPConfig()
        self._lock = threading.RLock()
        self._unsub: callable | None = None
        self._tracer = None
        self._spans_buffer: list[dict] = []
        self._flush_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._started = False

    def start(self) -> None:
        """Start the exporter. Subscribes to the EventBus and begins flushing."""
        if self._started:
            return
        try:
            from opentelemetry import trace
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                OTLPSpanExporter as GrpcExporter,
            )
        except ImportError as exc:
            log.warning(
                "opentelemetry-sdk not installed; OTLP exporter is a no-op. "
                "Install with: pip install opentelemetry-sdk opentelemetry-exporter-otlp. "
                "Error: %s",
                exc,
            )
            self._started = True  # mark as started so stop() is a no-op
            return

        resource = Resource.create({
            "service.name": self.cfg.service_name,
            "service.version": self.cfg.service_version,
        })
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(
            BatchSpanProcessor(
                GrpcExporter(endpoint=self.cfg.endpoint, insecure=True),
                max_export_batch_size=self.cfg.max_batch_size,
            )
        )
        trace.set_tracer_provider(provider)
        self._tracer = trace.get_tracer("kairo")

        # Subscribe to the EventBus — Kairo's tracing module publishes
        # span dicts on the TURN_END channel.
        self._unsub = get_event_bus().subscribe(EventKind.TURN_END, self._on_span)

        # Start background flush thread.
        self._stop_event.clear()
        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._flush_thread.start()
        self._started = True
        log.info("OTLP exporter started, endpoint=%s", self.cfg.endpoint)

    def stop(self) -> None:
        """Stop the exporter. Flushes any buffered spans."""
        if not self._started:
            return
        if self._unsub is not None:
            self._unsub()
            self._unsub = None
        self._stop_event.set()
        if self._flush_thread is not None:
            self._flush_thread.join(timeout=5)
            self._flush_thread = None
        self._flush_buffer()
        self._started = False

    def _on_span(self, payload: dict) -> None:
        """EventBus callback — buffer the span."""
        with self._lock:
            self._spans_buffer.append(payload)
            if len(self._spans_buffer) >= self.cfg.max_batch_size:
                self._flush_buffer()

    def _flush_loop(self) -> None:
        """Background thread that flushes the buffer periodically."""
        while not self._stop_event.wait(timeout=self.cfg.flush_interval_s):
            self._flush_buffer()

    def _flush_buffer(self) -> None:
        """Convert buffered Kairo spans to OTel spans and emit them."""
        with self._lock:
            buffer = list(self._spans_buffer)
            self._spans_buffer.clear()
        if not buffer or self._tracer is None:
            return
        for span_data in buffer:
            try:
                self._emit_otel_span(span_data)
            except Exception as exc:  # noqa: BLE001
                log.warning("failed to emit OTel span: %s", exc)

    def _emit_otel_span(self, span_data: dict) -> None:
        """Convert a Kairo span dict to an OpenTelemetry span."""
        from opentelemetry.trace import Status, StatusCode
        name = span_data.get("name", "kairo.span")
        attributes = span_data.get("attributes", {}) or {}
        status = span_data.get("status", "ok")
        error = span_data.get("error")
        duration_s = span_data.get("duration_s", 0.0)
        # Start a span that's already ended (we know the duration).
        with self._tracer.start_as_current_span(name) as otel_span:
            for k, v in attributes.items():
                try:
                    otel_span.set_attribute(k, v)
                except Exception:  # noqa: BLE001
                    pass
            otel_span.set_attribute("kairo.duration_s", duration_s)
            if status == "error":
                otel_span.set_status(Status(StatusCode.ERROR, error or "error"))
                if error:
                    otel_span.record_exception(Exception(error))
            else:
                otel_span.set_status(Status(StatusCode.OK))


# ---------------------------------------------------------------------------
# JSON-lines exporter — alternative to OTLP for simple setups
# ---------------------------------------------------------------------------

class JSONLinesExporter:
    """Writes spans to a JSON-lines file. No deps required.

    Useful for local debugging and for piping into tools like ``jq``.
    """

    def __init__(self, path) -> None:
        from pathlib import Path
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._unsub: callable | None = None
        self._fh = None
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        self._fh = open(self.path, "a", encoding="utf-8")
        self._unsub = get_event_bus().subscribe(EventKind.TURN_END, self._on_span)
        self._started = True
        log.info("JSON-lines span exporter writing to %s", self.path)

    def stop(self) -> None:
        if not self._started:
            return
        if self._unsub is not None:
            self._unsub()
            self._unsub = None
        if self._fh is not None:
            self._fh.close()
            self._fh = None
        self._started = False

    def _on_span(self, payload: dict) -> None:
        import json
        with self._lock:
            if self._fh is None:
                return
            self._fh.write(json.dumps(payload, default=str) + "\n")
            self._fh.flush()
