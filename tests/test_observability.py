"""Tests for kairo.observability — dashboard server."""

from __future__ import annotations

import json
import socket
import urllib.request
from pathlib import Path

import pytest

from kairo.agent.memory import SessionStore
from kairo.observability import DashboardServer
from kairo.types import AgentResult, AgentTurn, Message, ProviderResponse, Role


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _save_run(store: SessionStore):
    result = AgentResult(
        messages=[Message(role=Role.USER, content="hi"),
                  Message(role=Role.ASSISTANT, content="hello")],
        turns=[AgentTurn(
            index=0, request_messages=[],
            response=ProviderResponse(content="hello", tool_calls=[]),
        )],
        finish_reason="complete",
        total_tokens=100,
        total_cost_usd=0.001,
        total_duration_s=0.5,
    )
    store.save(result)


def test_dashboard_starts_and_stops(tmp_path: Path):
    port = _free_port()
    server = DashboardServer(workdir=tmp_path, port=port)
    url = server.start()
    assert f"127.0.0.1:{port}" in url
    server.stop()


def test_dashboard_serves_index(tmp_path: Path):
    port = _free_port()
    server = DashboardServer(workdir=tmp_path, port=port)
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=3)
        body = resp.read().decode()
        assert "Kairo" in body
        assert "Observability" in body
    finally:
        server.stop()


def test_dashboard_serves_runs(tmp_path: Path):
    store = SessionStore(tmp_path)
    _save_run(store)
    port = _free_port()
    server = DashboardServer(workdir=tmp_path, port=port)
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/runs", timeout=3)
        data = json.loads(resp.read())
        assert "runs" in data
        assert len(data["runs"]) >= 1
        assert data["runs"][0]["finish_reason"] == "complete"
    finally:
        server.stop()


def test_dashboard_serves_run_detail(tmp_path: Path):
    store = SessionStore(tmp_path)
    _save_run(store)
    runs = store.list_runs()
    run_file = runs[-1].name
    port = _free_port()
    server = DashboardServer(workdir=tmp_path, port=port)
    server.start()
    try:
        resp = urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/runs/{run_file}", timeout=3,
        )
        data = json.loads(resp.read())
        assert data["finish_reason"] == "complete"
        assert len(data["turns"]) == 1
    finally:
        server.stop()


def test_dashboard_serves_stats(tmp_path: Path):
    store = SessionStore(tmp_path)
    _save_run(store)
    _save_run(store)
    port = _free_port()
    server = DashboardServer(workdir=tmp_path, port=port)
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/stats", timeout=3)
        data = json.loads(resp.read())
        assert data["total_runs"] >= 2
        assert data["complete"] >= 2
        assert data["total_tokens"] >= 200
    finally:
        server.stop()


def test_dashboard_unknown_path_404(tmp_path: Path):
    port = _free_port()
    server = DashboardServer(workdir=tmp_path, port=port)
    server.start()
    try:
        with pytest.raises(Exception):
            urllib.request.urlopen(f"http://127.0.0.1:{port}/nope", timeout=3)
    finally:
        server.stop()
