"""Tests for kairo.observability.otlp — span exporters."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kairo.observability.otlp import JSONLinesExporter, OTLPConfig, OTLPExporter
from kairo.tracing import span
from kairo.utils import EventKind, get_event_bus


def test_otlp_exporter_no_op_when_sdk_missing(tmp_path: Path):
    """OTLPExporter should start without raising even if OTel SDK missing."""
    exporter = OTLPExporter(OTLPConfig(endpoint="http://localhost:4317"))
    exporter.start()  # should not raise
    exporter.stop()  # should not raise


def test_json_lines_exporter_writes_spans(tmp_path: Path):
    """JSONLinesExporter writes span dicts to a .jsonl file."""
    path = tmp_path / "spans.jsonl"
    exporter = JSONLinesExporter(path)
    exporter.start()
    try:
        with span("test.op", key="value"):
            pass
        # The span should have been written to the file.
        # (EventBus dispatch is synchronous, so it should be there.)
    finally:
        exporter.stop()
    text = path.read_text()
    # File may have one or more lines (other tests may emit too).
    assert text.strip()
    # Each line should be valid JSON.
    for line in text.strip().splitlines():
        d = json.loads(line)
        assert "name" in d
        assert "ts" in d


def test_json_lines_exporter_can_be_stopped_and_restarted(tmp_path: Path):
    path = tmp_path / "spans.jsonl"
    exporter = JSONLinesExporter(path)
    exporter.start()
    exporter.stop()
    # Restart should work.
    exporter.start()
    with span("another.op"):
        pass
    exporter.stop()
    assert path.read_text().strip()


def test_otlp_config_defaults():
    cfg = OTLPConfig()
    assert cfg.endpoint == "http://localhost:4317"
    assert cfg.service_name == "kairo"
    assert cfg.flush_interval_s == 5.0
    assert cfg.max_batch_size == 100


def test_otlp_exporter_idempotent_start_stop():
    exporter = OTLPExporter()
    exporter.start()
    exporter.start()  # should be a no-op
    exporter.stop()
    exporter.stop()  # should be a no-op
