"""Tests for kairo.tracing — span context manager + collector."""

from __future__ import annotations

import pytest

from kairo.tracing import SpanCollector, current_trace_id, format_trace, span


def test_span_basic():
    with SpanCollector() as c:
        with span("test.op", key="value"):
            pass
    assert len(c.spans) == 1
    s = c.spans[0]
    assert s.name == "test.op"
    assert s.status == "ok"
    assert s.attributes == {"key": "value"}
    assert s.duration_s >= 0


def test_span_records_error():
    with SpanCollector() as c:
        with pytest.raises(ValueError):
            with span("test.fail"):
                raise ValueError("boom")
    assert len(c.spans) == 1
    s = c.spans[0]
    assert s.status == "error"
    assert "ValueError" in (s.error or "")
    assert "boom" in (s.error or "")


def test_span_nested_parent_id():
    with SpanCollector() as c:
        with span("parent"):
            with span("child"):
                pass
    assert len(c.spans) == 2
    parent = next(s for s in c.spans if s.name == "parent")
    child = next(s for s in c.spans if s.name == "child")
    assert child.parent_id == parent.span_id
    assert parent.parent_id is None


def test_current_trace_id():
    with span("root"):
        tid = current_trace_id()
        assert tid is not None
        with span("child"):
            assert current_trace_id() == tid  # same trace
    # Outside the span, no trace.
    assert current_trace_id() is None


def test_span_collector_by_name():
    with SpanCollector() as c:
        with span("a"):
            pass
        with span("a"):
            pass
        with span("b"):
            pass
    assert len(c.by_name("a")) == 2
    assert len(c.by_name("b")) == 1
    assert len(c.by_name("c")) == 0


def test_span_collector_root_spans():
    with SpanCollector() as c:
        with span("root1"):
            with span("child"):
                pass
        with span("root2"):
            pass
    roots = c.root_spans()
    assert len(roots) == 2
    assert {s.name for s in roots} == {"root1", "root2"}


def test_format_trace_indents():
    with SpanCollector() as c:
        with span("root"):
            with span("child1"):
                pass
            with span("child2"):
                pass
    out = format_trace(c.spans)
    assert "root" in out
    assert "child1" in out
    assert "child2" in out
    # Root has 0 indent, children have 2 spaces.
    lines = out.splitlines()
    root_line = next(l for l in lines if "root" in l)
    assert not root_line.startswith("  ")
    child_line = next(l for l in lines if "child1" in l)
    assert child_line.startswith("  ")


def test_span_attributes_preserved():
    with SpanCollector() as c:
        with span("op", model="glm-4.6", tokens=123, tags=["a", "b"]):
            pass
    s = c.spans[0]
    assert s.attributes["model"] == "glm-4.6"
    assert s.attributes["tokens"] == 123
    assert s.attributes["tags"] == ["a", "b"]
