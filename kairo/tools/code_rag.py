"""Code-graph RAG — semantic code search over a workspace.

A lightweight code-search index that lets the agent ask questions like
"find functions that handle authentication" or "where do we process
payments" and get back relevant code snippets.

Implementation:
  * Build a per-file index of token n-grams (1-2 grams, lowercased).
  * Query with a natural-language string; rank files by TF-IDF cosine
    similarity.
  * Return the top-N matching file:line ranges with surrounding context.

This is NOT an embedding-based retriever — it's a fast, dependency-free
fallback that works well for small-to-medium workspaces. For larger
codebases or semantic search, swap in a real embedding model.
"""

from __future__ import annotations

import math
import re
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from kairo.tools.base import tool
from kairo.tools.file_ops import FileToolsConfig, _safe_resolve
from kairo.utils import get_logger

log = get_logger("tools.code_rag")


@dataclass(slots=True)
class CodeRagConfig:
    file_cfg: FileToolsConfig
    # File extensions to index.
    extensions: tuple[str, ...] = (".py", ".js", ".ts", ".tsx", ".jsx",
                                    ".go", ".rs", ".java", ".rb", ".md",
                                    ".yaml", ".yml", ".json", ".sh")
    # Max files to index.
    max_files: int = 1000
    # Max file size to index (bytes).
    max_file_bytes: int = 64 * 1024
    # How many surrounding lines to include in snippet results.
    snippet_context: int = 5


@dataclass(slots=True)
class _IndexedFile:
    path: Path
    rel_path: str
    lines: list[str]
    # Token counts for TF-IDF.
    token_counts: Counter
    total_tokens: int


@dataclass(slots=True)
class SearchResult:
    rel_path: str
    line_start: int
    line_end: int
    snippet: str
    score: float


class CodeRagIndex:
    """A simple TF-IDF code-search index.

    Build with :meth:`build`, query with :meth:`search`. Thread-safe
    after build (build is single-threaded by design).
    """

    def __init__(self, cfg: CodeRagConfig) -> None:
        self.cfg = cfg
        self._files: list[_IndexedFile] = []
        # IDF: token -> number of files containing it.
        self._idf: dict[str, float] = {}
        self._lock = threading.RLock()
        self._built = False

    # -- building ------------------------------------------------------

    def build(self) -> int:
        """Scan the workspace and build the index. Returns file count."""
        root = self.cfg.file_cfg.root.resolve()
        files: list[_IndexedFile] = []
        for ext in self.cfg.extensions:
            for p in root.rglob(f"*{ext}"):
                if len(files) >= self.cfg.max_files:
                    break
                if any(part.startswith(".") or part == "__pycache__" or part == "node_modules"
                       for part in p.parts):
                    continue
                size = p.stat().st_size
                if size > self.cfg.max_file_bytes:
                    continue
                try:
                    text = p.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                lines = text.splitlines()
                tokens = _tokenize(text)
                counts = Counter(tokens)
                files.append(_IndexedFile(
                    path=p,
                    rel_path=str(p.relative_to(root)),
                    lines=lines,
                    token_counts=counts,
                    total_tokens=max(1, len(tokens)),
                ))
        # Compute IDF.
        n = len(files)
        df: dict[str, int] = defaultdict(int)
        for f in files:
            for tok in f.token_counts:
                df[tok] += 1
        self._idf = {tok: math.log((n + 1) / (d + 1)) + 1.0 for tok, d in df.items()}
        with self._lock:
            self._files = files
            self._built = True
        log.info("code-rag index built: %d files, %d unique tokens",
                 len(files), len(self._idf))
        return len(files)

    # -- querying ------------------------------------------------------

    def search(self, query: str, *, limit: int = 5, min_score: float = 0.01) -> list[SearchResult]:
        """Search the index. Returns top-N results."""
        with self._lock:
            files = list(self._files)
            idf = dict(self._idf)
        if not files:
            return []
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []
        # Compute query vector (TF-IDF).
        query_counts = Counter(query_tokens)
        query_vec: dict[str, float] = {}
        for tok, cnt in query_counts.items():
            if tok in idf:
                query_vec[tok] = cnt * idf[tok]
        if not query_vec:
            return []
        query_norm = math.sqrt(sum(v * v for v in query_vec.values())) or 1.0
        # Score each file.
        scored: list[tuple[float, _IndexedFile]] = []
        for f in files:
            doc_vec = {tok: cnt * idf.get(tok, 0.0) for tok, cnt in f.token_counts.items()}
            doc_vec = {tok: v for tok, v in doc_vec.items() if v > 0}
            if not doc_vec:
                continue
            doc_norm = math.sqrt(sum(v * v for v in doc_vec.values())) or 1.0
            # Cosine similarity.
            dot = sum(query_vec.get(tok, 0.0) * v for tok, v in doc_vec.items())
            score = dot / (query_norm * doc_norm)
            if score >= min_score:
                scored.append((score, f))
        scored.sort(key=lambda x: -x[0])
        # Build snippets from top files.
        out: list[SearchResult] = []
        for score, f in scored[:limit]:
            snippet_lines = _best_snippet(f, query_tokens, self.cfg.snippet_context)
            out.append(SearchResult(
                rel_path=f.rel_path,
                line_start=snippet_lines[0],
                line_end=snippet_lines[1],
                snippet=snippet_lines[2],
                score=score,
            ))
        return out

    def stats(self) -> dict:
        with self._lock:
            return {
                "file_count": len(self._files),
                "unique_tokens": len(self._idf),
                "built": self._built,
            }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _tokenize(text: str) -> list[str]:
    """Tokenize code into lowercased words + camelCase splits."""
    out: list[str] = []
    for m in _TOKEN_RE.finditer(text):
        word = m.group(0)
        # Split camelCase FIRST (before lowercasing): "getUserInfo" -> "get User Info".
        parts = re.sub(r"([a-z])([A-Z])", r"\1 \2", word).split()
        # Also split snake_case: "get_user_info" -> "get", "user", "info".
        all_parts: list[str] = []
        for p in parts:
            all_parts.extend(p.split("_"))
        out.extend(p.lower() for p in all_parts if p)
    return out


def _best_snippet(
    f: _IndexedFile, query_tokens: list[str], context: int
) -> tuple[int, int, str]:
    """Find the best line range in ``f`` that matches the query tokens."""
    if not f.lines:
        return (1, 1, "")
    qt = set(query_tokens)
    best_line = 0
    best_score = 0
    for i, line in enumerate(f.lines):
        toks = set(_tokenize(line))
        score = len(qt & toks)
        if score > best_score:
            best_score = score
            best_line = i
    start = max(0, best_line - context)
    end = min(len(f.lines), best_line + context + 1)
    snippet = "\n".join(
        f"{i + 1:>5}\t{f.lines[i]}"
        for i in range(start, end)
    )
    return (start + 1, end, snippet)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

def make_code_rag_tools(cfg: CodeRagConfig):
    """Build code-RAG tools bound to ``cfg``."""
    index = CodeRagIndex(cfg)

    @tool(name="code_search")
    def code_search(query: str, limit: int = 5) -> str:
        """Semantic code search over the workspace.

        Uses a TF-IDF index over code tokens (camelCase split, lowercased).
        Returns the top-N matching files with the best-matching snippet.

        Args:
            query: Natural-language query (e.g. "where do we authenticate users").
            limit: Max results. Defaults to 5.

        Returns:
            One result per chunk: ``path:line-line (score)`` + snippet.
        """
        if not index._built:
            index.build()
        results = index.search(query, limit=limit)
        if not results:
            return "(no matches)"
        out: list[str] = []
        for r in results:
            out.append(f"=== {r.rel_path}:{r.line_start}-{r.line_end} (score {r.score:.3f}) ===")
            out.append(r.snippet)
        return "\n\n".join(out)

    @tool(name="code_search_rebuild")
    def code_search_rebuild() -> str:
        """Rebuild the code-search index. Call after significant file changes."""
        count = index.build()
        return f"Indexed {count} files"

    @tool(name="code_search_stats")
    def code_search_stats() -> str:
        """Return stats about the code-search index."""
        import json
        return json.dumps(index.stats(), indent=2)

    return [code_search, code_search_rebuild, code_search_stats]
