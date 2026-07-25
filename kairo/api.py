"""REST API server — expose Kairo as an HTTP service.

Wraps :class:`TenantManager` + :class:`AsyncAgent` into a FastAPI-style
HTTP API so Kairo can be used as a backend service.

Endpoints:
  POST   /api/run                 — start an agent run (returns run_id + streams)
  GET    /api/runs                 — list recent runs
  GET    /api/runs/{run_id}        — get a specific run's status + result
  POST   /api/runs/{run_id}/cancel — cancel a running agent
  GET    /api/tenants              — list all tenants
  POST   /api/tenants/{user_id}    — create a tenant
  GET    /api/tenants/{user_id}/usage — get tenant's budget usage
  POST   /api/tenants/{user_id}/budget — set tenant's budget limit
  GET    /api/models               — list available models
  GET    /api/presets              — list agent presets
  GET    /metrics                  — Prometheus metrics

Uses stdlib http.server (no FastAPI/Flask dep). JSON in/out.

Usage::

    from kairo.api import APIServer

    server = APIServer(workdir=Path("~/.kairo").expanduser(), port=8000)
    server.start()
    # API at http://localhost:8000/api/
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

from kairo.config import KairoConfig, load_config
from kairo.observability.metrics import MetricsCollector, MetricsServer
from kairo.tenant import TenantManager
from kairo.utils import get_logger

log = get_logger("api")


@dataclass(slots=True)
class RunRequest:
    """A pending or active agent run."""

    run_id: str
    user_id: str
    message: str
    preset: str | None = None
    status: str = "pending"  # pending, running, complete, error, cancelled
    result: dict | None = None
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    ended_at: float = 0.0
    task: asyncio.Task | None = None  # the asyncio task running the agent


class APIServer:
    """HTTP server that exposes Kairo as a REST API.

    Wraps TenantManager for multi-tenant isolation, AsyncAgent for
    non-blocking runs, and MetricsCollector for observability.
    """

    def __init__(
        self,
        workdir: Path | str,
        *,
        kairo_cfg: KairoConfig | None = None,
        host: str = "0.0.0.0",
        port: int = 8000,
    ) -> None:
        self.workdir = Path(workdir)
        self.kcfg = kairo_cfg or load_config()
        self.host = host
        self.port = port
        self.tenant_mgr = TenantManager(self.workdir)
        self.metrics = MetricsCollector.default()
        self._runs: dict[str, RunRequest] = {}
        self._lock = threading.RLock()
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._event_loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: threading.Thread | None = None

    def start(self) -> str:
        """Start the API server. Returns the base URL."""
        if self._server is not None:
            return f"http://{self.host}:{self.port}"

        # Start a background event loop for async agent runs.
        self._event_loop = asyncio.new_event_loop()
        self._loop_thread = threading.Thread(
            target=self._event_loop.run_forever, daemon=True,
        )
        self._loop_thread.start()

        server_ref = self

        class _Handler(BaseHTTPRequestHandler):
            def _send_json(self, code: int, body: Any) -> None:
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(body, default=str).encode())

            def _read_body(self) -> dict:
                length = int(self.headers.get("Content-Length", 0))
                if length == 0:
                    return {}
                body = self.rfile.read(length).decode("utf-8")
                try:
                    return json.loads(body)
                except json.JSONDecodeError:
                    return {}

            def do_GET(self) -> None:
                path = urlparse(self.path).path
                if path == "/api/runs":
                    self._handle_list_runs()
                elif path.startswith("/api/runs/"):
                    run_id = path[len("/api/runs/"):]
                    self._handle_get_run(run_id)
                elif path == "/api/tenants":
                    tenants = server_ref.tenant_mgr.list_tenants()
                    self._send_json(200, {"tenants": tenants})
                elif path.startswith("/api/tenants/") and path.endswith("/usage"):
                    user_id = path[len("/api/tenants/"):-len("/usage")]
                    self._handle_get_usage(user_id)
                elif path == "/api/models":
                    from kairo.routing import default_catalog
                    cat = default_catalog()
                    models = [
                        {"provider": m.provider, "name": m.name,
                         "context": m.context, "cost_in_per_m": m.cost_in_per_m,
                         "capabilities": list(m.capabilities)}
                        for m in cat.all()
                    ]
                    self._send_json(200, {"models": models})
                elif path == "/api/presets":
                    from kairo.presets import PRESETS
                    self._send_json(200, {"presets": [
                        {"name": p.name, "description": p.description}
                        for p in PRESETS.values()
                    ]})
                elif path == "/metrics":
                    body = server_ref.metrics.render().encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain; version=0.0.4")
                    self.end_headers()
                    self.wfile.write(body)
                elif path == "/" or path == "/health":
                    self._send_json(200, {"status": "ok", "version": "0.4.0"})
                else:
                    self._send_json(404, {"error": "not found"})

            def do_POST(self) -> None:
                path = urlparse(self.path).path
                if path == "/api/run":
                    self._handle_start_run()
                elif path.startswith("/api/runs/") and path.endswith("/cancel"):
                    run_id = path[len("/api/runs/"):-len("/cancel")]
                    self._handle_cancel_run(run_id)
                elif path.startswith("/api/tenants/") and path.endswith("/budget"):
                    user_id = path[len("/api/tenants/"):-len("/budget")]
                    self._handle_set_budget(user_id)
                else:
                    self._send_json(404, {"error": "not found"})

            def _handle_start_run(self) -> None:
                body = self._read_body()
                user_id = body.get("user_id", "anonymous")
                message = body.get("message", "")
                preset_name = body.get("preset")
                if not message:
                    self._send_json(400, {"error": "message is required"})
                    return
                # Get or create tenant.
                tenant = server_ref.tenant_mgr.get_or_create(user_id)
                # Build agent.
                if preset_name:
                    from kairo.presets import get_preset
                    try:
                        preset = get_preset(preset_name)
                        agent = tenant.build_agent(
                            preset.apply_to_kairo_config(server_ref.kcfg),
                            system_prompt=preset.persona_body,
                            max_turns=preset.max_turns,
                        )
                    except KeyError:
                        self._send_json(400, {"error": f"unknown preset: {preset_name}"})
                        return
                else:
                    agent = tenant.build_agent(
                        server_ref.kcfg,
                        system_prompt=body.get("system_prompt", ""),
                        max_turns=body.get("max_turns"),
                    )
                # Create run request.
                run_id = uuid.uuid4().hex[:16]
                run = RunRequest(
                    run_id=run_id, user_id=user_id, message=message,
                    preset=preset_name, status="running",
                )
                with server_ref._lock:
                    server_ref._runs[run_id] = run
                # Schedule the async run on the background loop.
                future = asyncio.run_coroutine_threadsafe(
                    server_ref._run_agent(run_id, agent, message),
                    server_ref._event_loop,
                )
                run.task = future  # type: ignore[assignment]
                self._send_json(202, {
                    "run_id": run_id, "status": "running",
                    "message": "Run started. Poll GET /api/runs/{run_id} for status.",
                })

            def _handle_list_runs(self) -> None:
                with server_ref._lock:
                    runs = [
                        {
                            "run_id": r.run_id, "user_id": r.user_id,
                            "status": r.status, "started_at": r.started_at,
                            "ended_at": r.ended_at,
                        }
                        for r in server_ref._runs.values()
                    ]
                runs.sort(key=lambda r: r["started_at"], reverse=True)
                self._send_json(200, {"runs": runs[:50]})

            def _handle_get_run(self, run_id: str) -> None:
                with server_ref._lock:
                    run = server_ref._runs.get(run_id)
                if run is None:
                    self._send_json(404, {"error": "run not found"})
                    return
                self._send_json(200, {
                    "run_id": run.run_id, "user_id": run.user_id,
                    "status": run.status, "message": run.message,
                    "preset": run.preset,
                    "started_at": run.started_at, "ended_at": run.ended_at,
                    "result": run.result, "error": run.error,
                })

            def _handle_cancel_run(self, run_id: str) -> None:
                with server_ref._lock:
                    run = server_ref._runs.get(run_id)
                if run is None:
                    self._send_json(404, {"error": "run not found"})
                    return
                if run.status != "running":
                    self._send_json(400, {"error": f"run is not running (status={run.status})"})
                    return
                # Cancel the asyncio task.
                if run.task is not None:
                    server_ref._event_loop.call_soon_threadsafe(
                        run.task.cancel,  # type: ignore[attr-defined]
                    )
                run.status = "cancelled"
                self._send_json(200, {"run_id": run_id, "status": "cancelled"})

            def _handle_get_usage(self, user_id: str) -> None:
                tenant = server_ref.tenant_mgr.get_or_create(user_id)
                usage = tenant.get_usage()
                self._send_json(200, usage.to_dict())

            def _handle_set_budget(self, user_id: str) -> None:
                body = self._read_body()
                from kairo.agent.budget_enforcer import BudgetLimit
                tenant = server_ref.tenant_mgr.get_or_create(user_id)
                limit = BudgetLimit(
                    max_cost_usd=body.get("max_cost_usd"),
                    max_tokens=body.get("max_tokens"),
                    max_turns=body.get("max_turns"),
                    max_wall_s=body.get("max_wall_s"),
                )
                tenant.set_budget_limit(limit)
                self._send_json(200, {"user_id": user_id, "limit_set": True})

            def log_message(self, fmt, *args) -> None:
                pass  # silence

        self._server = HTTPServer((self.host, self.port), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        url = f"http://{self.host}:{self.port}"
        log.info("API server running at %s", url)
        return url

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None
        if self._event_loop is not None:
            self._event_loop.call_soon_threadsafe(self._event_loop.stop)
            self._event_loop = None
        if self._loop_thread is not None:
            self._loop_thread.join(timeout=2)
            self._loop_thread = None

    async def _run_agent(self, run_id: str, agent, message: str) -> None:
        """Run the agent async and update the RunRequest when done."""
        with self._lock:
            run = self._runs.get(run_id)
        if run is None:
            return
        try:
            result = await agent.run(message)
            run.result = {
                "finish_reason": result.finish_reason,
                "turns": len(result.turns),
                "total_tokens": result.total_tokens,
                "total_cost_usd": result.total_cost_usd,
                "total_duration_s": result.total_duration_s,
                "error": result.error,
                "final_text": next(
                    (m.content for m in reversed(result.messages)
                     if m.role.value == "assistant" and m.content), "",
                ),
            }
            run.status = result.finish_reason
        except asyncio.CancelledError:
            run.status = "cancelled"
        except Exception as exc:  # noqa: BLE001
            run.status = "error"
            run.error = str(exc)
        finally:
            run.ended_at = time.time()
