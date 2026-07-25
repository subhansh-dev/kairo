"""Observability — web dashboard for inspecting agent runs.

Kairo persists every run to JSON. This module serves a simple HTML
dashboard that lists recent runs, lets you drill into a single run's
turns / tool calls / messages, and shows aggregated stats.

Run::

    from kairo.observability import DashboardServer
    server = DashboardServer(workdir=Path("~/.kairo"))
    server.start(port=8080)
    # Open http://localhost:8080 in a browser.

The dashboard is read-only — it doesn't trigger agent runs. It's
intended for post-hoc analysis and debugging.
"""

from __future__ import annotations

import html
import json
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from kairo.agent.memory import SessionStore
from kairo.utils import get_logger

log = get_logger("observability")


@dataclass(slots=True)
class DashboardServer:
    """HTTP server that serves a read-only dashboard over the run store."""

    workdir: Path
    host: str = "127.0.0.1"
    port: int = 0
    _server: HTTPServer | None = None
    _thread: threading.Thread | None = None

    def start(self) -> str:
        if self._server is not None:
            return f"http://{self.host}:{self.port}"
        if self.port == 0:
            import socket
            with socket.socket() as s:
                s.bind((self.host, 0))
                self.port = s.getsockname()[1]
        server_ref = self

        class _Handler(BaseHTTPRequestHandler):
            def _send_html(self, code: int, body: str) -> None:
                self.send_response(code)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body.encode())

            def _send_json(self, code: int, body: Any) -> None:
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(body, default=str).encode())

            def do_GET(self) -> None:
                path = urlparse(self.path).path
                if path == "/" or path == "/index.html":
                    self._serve_index()
                elif path == "/api/runs":
                    self._serve_runs()
                elif path.startswith("/api/runs/"):
                    run_file = path[len("/api/runs/"):]
                    self._serve_run_detail(run_file)
                elif path == "/api/stats":
                    self._serve_stats()
                else:
                    self._send_html(404, "not found")

            def _serve_index(self) -> None:
                self._send_html(200, _DASHBOARD_HTML)

            def _serve_runs(self) -> None:
                store = SessionStore(server_ref.workdir)
                runs = []
                for p in store.list_runs()[-50:]:  # last 50
                    try:
                        data = store.load(p)
                        runs.append({
                            "file": p.name,
                            "finish_reason": data.get("finish_reason"),
                            "turns": len(data.get("turns", [])),
                            "tokens": data.get("total_tokens", 0),
                            "cost_usd": data.get("total_cost_usd", 0),
                            "duration_s": data.get("total_duration_s", 0),
                            "saved_at": data.get("saved_at", 0),
                        })
                    except Exception:  # noqa: BLE001
                        pass
                self._send_json(200, {"runs": runs})

            def _serve_run_detail(self, run_file: str) -> None:
                p = server_ref.workdir / "runs" / run_file
                if not p.is_file():
                    self._send_json(404, {"error": "not found"})
                    return
                try:
                    data = json.loads(p.read_text())
                except Exception as exc:  # noqa: BLE001
                    self._send_json(500, {"error": str(exc)})
                    return
                self._send_json(200, data)

            def _serve_stats(self) -> None:
                store = SessionStore(server_ref.workdir)
                runs = store.list_runs()
                total = len(runs)
                complete = 0
                errors = 0
                total_tokens = 0
                total_cost = 0.0
                for p in runs:
                    try:
                        data = store.load(p)
                        if data.get("finish_reason") == "complete":
                            complete += 1
                        elif data.get("finish_reason") in ("error", "loop_limit", "budget"):
                            errors += 1
                        total_tokens += data.get("total_tokens", 0)
                        total_cost += data.get("total_cost_usd", 0)
                    except Exception:  # noqa: BLE001
                        pass
                self._send_json(200, {
                    "total_runs": total,
                    "complete": complete,
                    "errors": errors,
                    "total_tokens": total_tokens,
                    "total_cost_usd": total_cost,
                })

            def log_message(self, fmt, *args) -> None:
                pass  # silence

        self._server = HTTPServer((self.host, self.port), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        url = f"http://{self.host}:{self.port}"
        log.info("dashboard running at %s", url)
        return url

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None


# ---------------------------------------------------------------------------
# HTML (inline to avoid extra files)
# ---------------------------------------------------------------------------

_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kairo Observability Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 2rem; background: #fafafa; color: #222; }
    h1 { color: #0066cc; }
    .stats { display: flex; gap: 1rem; margin: 1rem 0; }
    .stat { background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); min-width: 120px; }
    .stat-label { color: #666; font-size: 0.85rem; }
    .stat-value { font-size: 1.5rem; font-weight: bold; }
    table { background: white; border-collapse: collapse; width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 0.6rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; font-weight: 600; }
    .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .badge-complete { background: #d4edda; color: #155724; }
    .badge-error { background: #f8d7da; color: #721c24; }
    .badge-loop_limit { background: #fff3cd; color: #856404; }
    .badge-budget { background: #fff3cd; color: #856404; }
    .badge-cancelled { background: #d1ecf1; color: #0c5460; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    #detail { display: none; margin-top: 2rem; background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    pre { background: #f5f5f5; padding: 0.5rem; overflow-x: auto; border-radius: 4px; font-size: 0.85rem; }
    .turn { border-left: 3px solid #0066cc; padding-left: 1rem; margin: 0.5rem 0; }
    .tool-result { background: #f9f9f9; padding: 0.5rem; margin: 0.3rem 0; border-radius: 4px; font-family: monospace; font-size: 0.85rem; }
    .ok { color: #155724; }
    .err { color: #721c24; }
    button { background: #0066cc; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0052a3; }
  </style>
</head>
<body>
  <h1>Kairo Observability Dashboard</h1>
  <div class="stats" id="stats"></div>
  <h2>Recent Runs</h2>
  <table>
    <thead>
      <tr>
        <th>Run</th>
        <th>Finish</th>
        <th>Turns</th>
        <th>Tokens</th>
        <th>Cost</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody id="runs-table"></tbody>
  </table>
  <div id="detail"></div>

  <script>
    async function loadStats() {
      const resp = await fetch('/api/stats');
      const stats = await resp.json();
      const el = document.getElementById('stats');
      el.innerHTML = `
        <div class="stat"><div class="stat-label">Total Runs</div><div class="stat-value">${stats.total_runs}</div></div>
        <div class="stat"><div class="stat-label">Complete</div><div class="stat-value">${stats.complete}</div></div>
        <div class="stat"><div class="stat-label">Errors</div><div class="stat-value">${stats.errors}</div></div>
        <div class="stat"><div class="stat-label">Total Tokens</div><div class="stat-value">${stats.total_tokens.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">Total Cost</div><div class="stat-value">$${stats.total_cost_usd.toFixed(4)}</div></div>
      `;
    }

    async function loadRuns() {
      const resp = await fetch('/api/runs');
      const data = await resp.json();
      const tbody = document.getElementById('runs-table');
      tbody.innerHTML = data.runs.map(r => `
        <tr>
          <td><a href="#" onclick="loadDetail('${r.file}'); return false;">${r.file}</a></td>
          <td><span class="badge badge-${r.finish_reason}">${r.finish_reason}</span></td>
          <td>${r.turns}</td>
          <td>${r.tokens.toLocaleString()}</td>
          <td>$${r.cost_usd.toFixed(4)}</td>
          <td>${r.duration_s.toFixed(1)}s</td>
        </tr>
      `).join('');
    }

    async function loadDetail(file) {
      const resp = await fetch('/api/runs/' + file);
      const data = await resp.json();
      const el = document.getElementById('detail');
      el.style.display = 'block';
      let html = `<h2>${file}</h2>`;
      html += `<p><strong>Finish:</strong> ${data.finish_reason} | <strong>Tokens:</strong> ${data.total_tokens} | <strong>Cost:</strong> $${(data.total_cost_usd || 0).toFixed(4)} | <strong>Duration:</strong> ${(data.total_duration_s || 0).toFixed(1)}s</p>`;
      if (data.error) html += `<p class="err">Error: ${escapeHtml(data.error)}</p>`;
      html += '<h3>Turns</h3>';
      (data.turns || []).forEach((t, i) => {
        html += `<div class="turn">`;
        html += `<p><strong>Turn ${i}:</strong> phase=${t.phase || '?'} model=${t.model || '?'} provider=${t.provider || '?'}</p>`;
        if (t.response && t.response.content) {
          html += `<pre>Assistant: ${escapeHtml(t.response.content.substring(0, 500))}${t.response.content.length > 500 ? '...' : ''}</pre>`;
        }
        if (t.tool_results) {
          t.tool_results.forEach(tr => {
            const cls = tr.ok ? 'ok' : 'err';
            const content = tr.content ? String(tr.content).substring(0, 300) : '';
            const error = tr.error ? escapeHtml(tr.error.substring(0, 300)) : '';
            html += `<div class="tool-result"><span class="${cls}">[${tr.ok ? 'OK' : 'ERR'}] ${tr.name}</span> ${escapeHtml(content)}${error ? '<br>error: ' + error : ''}</div>`;
          });
        }
        html += `</div>`;
      });
      html += '<h3>Messages</h3><pre>' + escapeHtml(JSON.stringify(data.messages || [], null, 2)) + '</pre>';
      html += `<button onclick="document.getElementById('detail').style.display='none';">Close</button>`;
      el.innerHTML = html;
    }

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }

    loadStats();
    loadRuns();
  </script>
</body>
</html>
"""
