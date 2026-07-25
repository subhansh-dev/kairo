"""Browser automation tools — wraps the agent-browser CLI.

These tools let the agent drive a headless browser: navigate, click,
type, screenshot, extract text. Useful for web testing, scraping,
and verifying web-design work.

The underlying engine is the ``agent-browser`` CLI (Rust binary with
Node.js fallback). If it's not installed, every tool returns a clear
error so the model can fall back to ``web_fetch``.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from kairo.errors import ToolError
from kairo.tools.base import tool
from kairo.utils import get_logger

log = get_logger("tools.browser")


@dataclass(slots=True)
class BrowserToolsConfig:
    # Override the agent-browser binary path. When None, uses PATH lookup.
    binary: str | None = None
    # Default timeout per command (seconds).
    timeout_s: float = 30.0
    # Default viewport.
    viewport_width: int = 1280
    viewport_height: int = 800
    # Whether to take a screenshot after each navigation.
    screenshot_after_nav: bool = True


def _resolve_binary(cfg: BrowserToolsConfig) -> str:
    bin_path = cfg.binary or shutil.which("agent-browser")
    if bin_path is None:
        raise ToolError(
            "browser",
            "agent-browser is not installed. Install with `npm install -g agent-browser`.",
        )
    return bin_path


def _run(cfg: BrowserToolsConfig, args: list[str], timeout: float | None = None) -> str:
    bin_path = _resolve_binary(cfg)
    cmd = [bin_path, *args, "--json"]  # request JSON output
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout or cfg.timeout_s,
        )
    except subprocess.TimeoutExpired as exc:
        raise ToolError("browser", f"agent-browser timed out after {timeout or cfg.timeout_s}s") from exc
    if proc.returncode != 0:
        err = proc.stderr.strip()[:500] or proc.stdout.strip()[:500]
        raise ToolError("browser", f"agent-browser exited {proc.returncode}: {err}")
    return proc.stdout


def make_browser_tools(cfg: BrowserToolsConfig):
    """Build browser-automation tools bound to ``cfg``."""

    @tool(name="browser_navigate", tags=("browser",))
    def browser_navigate(url: str, screenshot: bool | None = None) -> str:
        """Navigate the browser to a URL.

        Args:
            url: HTTP(S) URL to navigate to.
            screenshot: When True, capture a PNG after navigation.
                Defaults to the config's screenshot_after_nav.

        Returns:
            JSON object with title, url, and (optionally) screenshot path.
        """
        if not url.startswith(("http://", "https://")):
            raise ToolError("browser_navigate", f"URL must be http(s): {url!r}")
        do_shot = cfg.screenshot_after_nav if screenshot is None else screenshot
        args = ["navigate", url]
        if do_shot:
            args += ["--screenshot"]
        return _run(cfg, args)

    @tool(name="browser_click", tags=("browser",))
    def browser_click(selector: str) -> str:
        """Click an element matching ``selector`` (CSS or text).

        Args:
            selector: CSS selector (e.g. ``#submit``) or text (e.g. ``Sign in``).
        """
        return _run(cfg, ["click", selector])

    @tool(name="browser_type", tags=("browser",))
    def browser_type(selector: str, text: str, submit: bool = False) -> str:
        """Type ``text`` into the input matching ``selector``.

        Args:
            selector: CSS selector for the input element.
            text: Text to type.
            submit: When True, press Enter after typing.
        """
        args = ["type", selector, text]
        if submit:
            args.append("--submit")
        return _run(cfg, args)

    @tool(name="browser_snapshot", tags=("browser",))
    def browser_snapshot() -> str:
        """Capture the current page's accessibility tree + visible text.

        Returns:
            JSON object with the page structure.
        """
        return _run(cfg, ["snapshot"])

    @tool(name="browser_screenshot", tags=("browser",))
    def browser_screenshot(path: str = "screenshot.png") -> str:
        """Take a screenshot of the current page.

        Args:
            path: Where to save the PNG (relative to workspace).
        """
        return _run(cfg, ["screenshot", "--output", path])

    @tool(name="browser_extract", tags=("browser",))
    def browser_extract(selector: str = "body") -> str:
        """Extract text content from elements matching ``selector``.

        Args:
            selector: CSS selector. Defaults to ``body`` (whole page).

        Returns:
            JSON object with extracted text per matching element.
        """
        return _run(cfg, ["extract", selector])

    @tool(name="browser_eval", tags=("browser", "dangerous"))
    def browser_eval(script: str) -> str:
        """Evaluate JavaScript in the current page. Dangerous.

        Args:
            script: JavaScript expression to evaluate.
        """
        return _run(cfg, ["eval", script])

    @tool(name="browser_close", tags=("browser",))
    def browser_close() -> str:
        """Close the browser session."""
        return _run(cfg, ["close"])

    return [
        browser_navigate,
        browser_click,
        browser_type,
        browser_snapshot,
        browser_screenshot,
        browser_extract,
        browser_eval,
        browser_close,
    ]
