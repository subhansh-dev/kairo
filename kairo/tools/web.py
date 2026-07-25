"""Web tools — URL fetch + (optional) search.

We don't bundle a search backend by default — too many API keys, too
many ToS quirks. Instead we expose ``web_fetch`` which is enough for the
agent to read docs / GitHub issues / API references on demand. A
``web_search`` stub is included but raises unless a backend is wired in
by the host application.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from kairo.errors import ToolError
from kairo.tools.base import tool
from kairo.utils import get_logger

log = get_logger("tools.web")


@dataclass(slots=True)
class WebToolsConfig:
    timeout_s: float = 30.0
    # Max response size (bytes) before truncation.
    max_bytes: int = 256 * 1024
    user_agent: str = "kairo/0.1 (+https://github.com/kairo)"
    # Optional callable: (query) -> list[dict]. When None, web_search errors.
    search_backend: object | None = None


def make_web_tools(cfg: WebToolsConfig):
    @tool(name="web_fetch")
    def web_fetch(url: str, max_chars: int = 32_000) -> str:
        """HTTP GET a URL and return the body as text.

        Args:
            url: HTTP(S) URL.
            max_chars: Truncate the body to this many characters.

        Returns:
            Body text (or first chunk), plus a ``[status N, X bytes]`` footer.
        """
        if not url.startswith(("http://", "https://")):
            raise ToolError("web_fetch", f"URL must be http(s): {url!r}")
        try:
            with httpx.Client(
                timeout=cfg.timeout_s,
                headers={"User-Agent": cfg.user_agent},
                follow_redirects=True,
            ) as client:
                resp = client.get(url)
        except httpx.HTTPError as exc:
            raise ToolError("web_fetch", f"HTTP error: {exc}") from exc
        body = resp.text
        truncated = ""
        if len(body) > max_chars:
            truncated = f" (truncated from {len(body)} chars)"
            body = body[:max_chars]
        return f"{body}\n\n[status {resp.status_code}, {len(resp.content)} bytes{truncated}]"

    @tool(name="web_search")
    def web_search(query: str, max_results: int = 5) -> str:
        """Search the web.

        Search requires a backend wired in by the host application. If
        no backend is configured this tool returns an error so the model
        knows to fall back to ``web_fetch`` with a known URL.
        """
        if cfg.search_backend is None:
            raise ToolError(
                "web_search",
                "no search backend configured; call kairo.tools.web.set_search_backend()",
            )
        results = cfg.search_backend(query, max_results)  # type: ignore[misc]
        if not results:
            return "(no results)"
        lines = []
        for i, r in enumerate(results[:max_results], 1):
            title = r.get("title", "(untitled)")
            url = r.get("url", "")
            snippet = r.get("snippet", "")
            lines.append(f"{i}. {title}\n   {url}\n   {snippet}")
        return "\n\n".join(lines)

    return [web_fetch, web_search]
