"""Web design tools — HTML/CSS generation, live preview, screenshot.

Gives the agent a "web design" workflow:
  * ``write_html`` — write an HTML file with optional boilerplate.
  * ``write_css`` — write a CSS file.
  * ``preview_html`` — render an HTML file to a PNG via headless
    Playwright/Chromium (when available) or fall back to a textual
    outline when no browser is installed.
  * ``validate_html`` — basic structural validation (tags balanced,
    required elements present).
  * ``extract_outline`` — produce a text outline of an HTML file's
    structure (h1/h2/h3, sections, images) for the agent to reason about.
  * ``start_dev_server`` — start a static file server in the background
    and return its URL.

These tools are workspace-scoped: all paths are resolved against the
agent's workspace root.
"""

from __future__ import annotations

import http.server
import os
import re
import socketserver
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from kairo.errors import ToolError
from kairo.tools.base import tool
from kairo.tools.file_ops import FileToolsConfig, _safe_resolve
from kairo.utils import get_logger

log = get_logger("tools.web_design")


HTML_BOILERPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
{body}
</body>
</html>
"""


@dataclass(slots=True)
class WebDesignToolsConfig:
    file_cfg: FileToolsConfig
    # When True, preview_html uses headless Chromium if available.
    use_browser: bool = True
    # Max HTML bytes for validate/outline.
    max_bytes: int = 256 * 1024
    # Background dev servers started by start_dev_server.
    _servers: dict[int, subprocess.Popen] = field(default_factory=dict, repr=False)
    _ports_in_use: set[int] = field(default_factory=set, repr=False)


def make_web_design_tools(cfg: WebDesignToolsConfig):
    root = cfg.file_cfg.root

    @tool(name="write_html", tags=("mutating",))
    def write_html(path: str, content: str, wrap_boilerplate: bool = False,
                   title: str = "Untitled") -> str:
        """Write an HTML file. Optionally wrap content in boilerplate.

        Args:
            path: Workspace-relative path (e.g. ``index.html``).
            content: The HTML body (or full document if wrap_boilerplate is False).
            wrap_boilerplate: When True, ``content`` is treated as the
                ``<body>`` and wrapped in a full HTML document.
            title: ``<title>`` for the boilerplate.
        """
        p = _safe_resolve(root, path, allow_symlinks=False)
        p.parent.mkdir(parents=True, exist_ok=True)
        if wrap_boilerplate:
            html = HTML_BOILERPLATE.format(title=title, body=content)
        else:
            html = content
        p.write_text(html, encoding="utf-8")
        return f"Wrote {len(html)} chars to {p.relative_to(root.resolve())}"

    @tool(name="write_css", tags=("mutating",))
    def write_css(path: str, content: str) -> str:
        """Write a CSS file."""
        p = _safe_resolve(root, path, allow_symlinks=False)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"Wrote {len(content)} chars to {p.relative_to(root.resolve())}"

    @tool(name="validate_html")
    def validate_html(path: str) -> str:
        """Basic structural validation of an HTML file.

        Checks: file exists, starts with DOCTYPE, has <html>, <head>,
        <body>; tags are balanced (best-effort, no full parser).
        """
        p = _safe_resolve(root, path, allow_symlinks=False)
        if not p.is_file():
            raise ToolError("validate_html", f"file not found: {path!r}")
        text = p.read_text(encoding="utf-8", errors="replace")
        issues: list[str] = []
        if not text.strip().lower().startswith("<!doctype html>"):
            issues.append("missing <!DOCTYPE html> at start")
        if "<html" not in text.lower():
            issues.append("missing <html> tag")
        if "<head" not in text.lower():
            issues.append("missing <head> tag")
        if "<body" not in text.lower():
            issues.append("missing <body> tag")
        # Tag-balance check.
        balance = _tag_balance(text)
        if balance:
            issues.append(f"unbalanced tags: {', '.join(balance[:5])}")
        if not issues:
            return "OK — HTML looks well-formed (basic checks passed)."
        return "Issues found:\n- " + "\n- ".join(issues)

    @tool(name="extract_outline")
    def extract_outline(path: str) -> str:
        """Extract a text outline of an HTML file's structure.

        Walks h1-h6, section, article, main, img[alt] tags and produces
        an indented text outline. Useful for the agent to verify a page
        has the right structure.
        """
        p = _safe_resolve(root, path, allow_symlinks=False)
        if not p.is_file():
            raise ToolError("extract_outline", f"file not found: {path!r}")
        text = p.read_text(encoding="utf-8", errors="replace")
        lines: list[str] = []
        # Headings + structural tags.
        for m in re.finditer(
            r"<(h[1-6]|section|article|main)(\s[^>]*)?>",
            text, re.IGNORECASE | re.DOTALL,
        ):
            tag = m.group(1).lower()
            if tag.startswith("h") and len(tag) == 2:
                level = int(tag[1])
                end = text.find(f"</{tag}>", m.end())
                if end == -1:
                    continue
                content = re.sub(r"<[^>]+>", "", text[m.end():end]).strip()
                lines.append(f"{'  ' * (level - 1)}H{level}: {content[:100]}")
            elif tag in ("section", "article", "main"):
                lines.append(f"  <{tag}>")
        # Images with alt text — separate regex because the combined one
        # couldn't reliably capture the alt attribute.
        for m in re.finditer(
            r"<img\s+[^>]*alt=[\"']([^\"']*)[\"'][^>]*>",
            text, re.IGNORECASE,
        ):
            alt = m.group(1)
            if alt:
                lines.append(f"  IMG: {alt[:100]}")
        return "\n".join(lines) if lines else "(no structure found)"

    @tool(name="preview_html")
    def preview_html(path: str, width: int = 1280, height: int = 800) -> str:
        """Render an HTML file to a PNG screenshot.

        Uses headless Chromium when available (tries ``chromium``,
        ``google-chrome``, ``playwright``). Falls back to a textual
        outline when no browser is installed.
        """
        p = _safe_resolve(root, path, allow_symlinks=False)
        if not p.is_file():
            raise ToolError("preview_html", f"file not found: {path!r}")
        if not cfg.use_browser:
            return extract_outline(path=path)
        # Try chromium / chrome headless.
        for bin_name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
            bin_path = _which(bin_name)
            if bin_path is None:
                continue
            out_png = p.with_suffix(".preview.png")
            try:
                proc = subprocess.run(
                    [bin_path, "--headless", "--disable-gpu", "--no-sandbox",
                     f"--window-size={width}x{height}",
                     f"--screenshot={out_png}", f"file://{p}"],
                    capture_output=True, text=True, timeout=20,
                )
            except subprocess.TimeoutExpired:
                return f"chromium timed out; falling back to outline:\n{extract_outline(path=path)}"
            if out_png.exists() and out_png.stat().st_size > 0:
                return f"Screenshot saved to {out_png.relative_to(root.resolve())} ({out_png.stat().st_size} bytes)"
            return (f"chromium exited {proc.returncode} but produced no screenshot; "
                    f"falling back to outline:\n{extract_outline(path=path)}")
        # Try playwright if installed.
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
            out_png = p.with_suffix(".preview.png")
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
                page = browser.new_page(viewport={"width": width, "height": height})
                page.goto(f"file://{p}")
                page.screenshot(path=str(out_png))
                browser.close()
            if out_png.exists():
                return f"Screenshot saved to {out_png.relative_to(root.resolve())} ({out_png.stat().st_size} bytes)"
        except ImportError:
            pass
        except Exception as exc:  # noqa: BLE001
            log.warning("playwright screenshot failed: %s", exc)
        return (f"No browser available; falling back to outline:\n{extract_outline(path=path)}")

    @tool(name="start_dev_server", tags=("dangerous",))
    def start_dev_server(port: int = 8000, host: str = "127.0.0.1") -> str:
        """Start a static-file dev server in the workspace background.

        Returns the URL. The server runs until the agent process exits
        or ``stop_dev_server`` is called.
        """
        if port in cfg._ports_in_use:
            return f"http://{host}:{port}/ (already running)"
        # Use stdlib http.server in a thread — simplest path, no deps.
        handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(
            *a, directory=str(root.resolve()), **kw)
        try:
            srv = socketserver.TCPServer((host, port), handler)
        except OSError as exc:
            raise ToolError("start_dev_server", f"could not bind {host}:{port}: {exc}") from exc
        srv.allow_reuse_address = True
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        cfg._ports_in_use.add(port)
        # Track the server object so we can shut it down.
        cfg._servers[port] = srv  # type: ignore[assignment]
        return f"http://{host}:{port}/  (serving {root.resolve()})"

    @tool(name="stop_dev_server", tags=("dangerous",))
    def stop_dev_server(port: int) -> str:
        """Stop a dev server started by start_dev_server."""
        srv = cfg._servers.get(port)
        if srv is None:
            return f"no server on port {port}"
        try:
            srv.shutdown()
        except Exception as exc:  # noqa: BLE001
            return f"error stopping server: {exc}"
        cfg._servers.pop(port, None)
        cfg._ports_in_use.discard(port)
        return f"stopped server on port {port}"

    return [
        write_html, write_css, validate_html, extract_outline,
        preview_html, start_dev_server, stop_dev_server,
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _which(name: str) -> str | None:
    import shutil
    return shutil.which(name)


def _tag_balance(html: str) -> list[str]:
    """Best-effort tag balance check. Returns a list of imbalanced tags."""
    # Strip comments and scripts.
    html = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Self-closing / void tags we don't expect to balance.
    void = {"area", "base", "br", "col", "embed", "hr", "img", "input",
            "link", "meta", "param", "source", "track", "wbr"}
    stack: list[str] = []
    issues: list[str] = []
    for m in re.finditer(r"</?([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?(/?)>", html):
        full = m.group(0)
        name = m.group(1).lower()
        is_close = full.startswith("</")
        self_close = m.group(3) == "/" or name in void
        if is_close:
            if not stack or stack[-1] != name:
                issues.append(f"unexpected </{name}>")
                # Try to recover by popping until we find a match.
                while stack and stack[-1] != name:
                    issues.append(f"unclosed <{stack.pop()}>")
                if stack:
                    stack.pop()
            else:
                stack.pop()
        elif not self_close:
            stack.append(name)
    for name in stack:
        issues.append(f"unclosed <{name}>")
    return issues
