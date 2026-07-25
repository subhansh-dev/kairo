"""Tests for kairo.api — REST API server."""

from __future__ import annotations

import json
import socket
import time
import urllib.request
from pathlib import Path

import pytest

from kairo.api import APIServer


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_api_server_starts_and_stops(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    url = server.start()
    assert f"127.0.0.1:{port}" in url
    server.stop()


def test_api_health_check(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3)
        data = json.loads(resp.read())
        assert data["status"] == "ok"
    finally:
        server.stop()


def test_api_list_tenants_empty(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/tenants", timeout=3)
        data = json.loads(resp.read())
        assert data["tenants"] == []
    finally:
        server.stop()


def test_api_list_models(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/models", timeout=3)
        data = json.loads(resp.read())
        assert len(data["models"]) > 0
        assert "provider" in data["models"][0]
    finally:
        server.stop()


def test_api_list_presets(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/presets", timeout=3)
        data = json.loads(resp.read())
        assert len(data["presets"]) >= 5
        names = [p["name"] for p in data["presets"]]
        assert "coding-agent" in names
    finally:
        server.stop()


def test_api_set_budget(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        body = json.dumps({"max_turns": 10, "max_cost_usd": 1.0}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/tenants/alice/budget",
            data=body, headers={"Content-Type": "application/json"}, method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=3)
        data = json.loads(resp.read())
        assert data["limit_set"] is True
    finally:
        server.stop()


def test_api_get_usage(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        resp = urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/tenants/alice/usage", timeout=3,
        )
        data = json.loads(resp.read())
        assert "cost_usd" in data
        assert "tokens" in data
    finally:
        server.stop()


def test_api_start_run_no_message(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        body = json.dumps({"user_id": "alice"}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/run",
            data=body, headers={"Content-Type": "application/json"}, method="POST",
        )
        with pytest.raises(Exception):
            urllib.request.urlopen(req, timeout=3)
    finally:
        server.stop()


def test_api_get_run_not_found(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        with pytest.raises(Exception):
            urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/runs/nonexistent", timeout=3,
            )
    finally:
        server.stop()


def test_api_metrics_endpoint(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics", timeout=3)
        body = resp.read().decode()
        # Metrics may be empty if no events fired yet — just verify it's text.
        assert resp.status == 200
    finally:
        server.stop()


def test_api_list_runs_empty(tmp_path: Path):
    port = _free_port()
    server = APIServer(workdir=tmp_path, port=port, host="127.0.0.1")
    server.start()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/runs", timeout=3)
        data = json.loads(resp.read())
        assert data["runs"] == []
    finally:
        server.stop()
