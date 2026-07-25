"""Optional embedding backends for Kairo RAG.

The default :class:`KeywordOverlapEmbeddings` works with zero
dependencies but isn't great at semantic similarity. This module
provides adapters for real embedding backends that you can drop in
when they're available.

Each adapter tries to import its dependency at construction time and
raises a clear ``ImportError`` with install instructions if the dep
is missing. That way the rest of Kairo keeps working without the dep.

Supported backends:
  * :class:`SentenceTransformersEmbeddings` — uses the
    `sentence-transformers` PyPI package. Best local option.
  * :class:`OpenAIEmbeddings` — uses the `openai` package. Best hosted
    option, but costs money.
  * :class:`FastEmbedEmbeddings` — uses the `fastembed` package
    (ONNX-based, CPU-friendly, no PyTorch dep).

All three implement the :class:`kairo.rag.Embeddings` protocol so they
can be passed to :class:`kairo.rag.VectorStore` directly.
"""

from __future__ import annotations

import hashlib
from typing import Any

from kairo.rag import Embeddings
from kairo.utils import get_logger

log = get_logger("rag.embeddings_backends")


# ---------------------------------------------------------------------------
# sentence-transformers
# ---------------------------------------------------------------------------

class SentenceTransformersEmbeddings:
    """Embeddings backend using the `sentence-transformers` package.

    Install with: ``pip install sentence-transformers``

    The model is downloaded on first use (~80MB for the default
    all-MiniLM-L6-v2) and cached locally for subsequent runs.
    """

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> None:
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "sentence-transformers is not installed. "
                "Install with: pip install sentence-transformers"
            ) from exc
        self._model = SentenceTransformer(model_name)
        self._dim: int | None = None
        self.model_name = model_name

    @property
    def dim(self) -> int:
        if self._dim is None:
            # Embed a probe to discover the dimension.
            self._dim = len(self._model.encode(["probe"])[0])
        return self._dim

    def embed(self, text: str) -> list[float]:
        if not text:
            return [0.0] * self.dim
        vec = self._model.encode([text])[0]
        return vec.tolist()


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------

class OpenAIEmbeddings:
    """Embeddings backend using the OpenAI embeddings API.

    Install with: ``pip install openai``
    """

    def __init__(self, model: str = "text-embedding-3-small",
                 api_key: str | None = None,
                 base_url: str | None = None) -> None:
        try:
            from openai import OpenAI  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "openai is not installed. Install with: pip install openai"
            ) from exc
        kwargs: dict[str, Any] = {}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        self._client = OpenAI(**kwargs)
        self.model = model
        # text-embedding-3-small is 1536-dim; ada-002 is 1536 too.
        self._dim = 1536 if "3-small" in model or "ada" in model else 3072

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, text: str) -> list[float]:
        if not text:
            return [0.0] * self.dim
        resp = self._client.embeddings.create(model=self.model, input=text)
        return resp.data[0].embedding


# ---------------------------------------------------------------------------
# FastEmbed (ONNX-based, CPU-friendly)
# ---------------------------------------------------------------------------

class FastEmbedEmbeddings:
    """Embeddings backend using the `fastembed` package.

    Install with: ``pip install fastembed``
    """

    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5") -> None:
        try:
            from fastembed import TextEmbedding  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "fastembed is not installed. Install with: pip install fastembed"
            ) from exc
        self._model = TextEmbedding(model_name=model_name)
        self.model_name = model_name
        self._dim: int | None = None

    @property
    def dim(self) -> int:
        if self._dim is None:
            self._dim = len(next(self._model.embed(["probe"])))
        return self._dim

    def embed(self, text: str) -> list[float]:
        if not text:
            return [0.0] * self.dim
        return next(self._model.embed([text])).tolist()


# ---------------------------------------------------------------------------
# Hashing embeddings — ultra-lightweight deterministic fallback
# ---------------------------------------------------------------------------

class HashingEmbeddings:
    """Deterministic hash-based embeddings — zero-dep, fast, but no semantic info.

    Each token is mapped to a dimension via hashing; the vector is the
    sum of token hashes (binary). Useful as a sanity-check baseline or
    when you need deterministic-but-meaningless vectors for testing.
    """

    def __init__(self, dim: int = 256) -> None:
        self._dim = dim

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, text: str) -> list[float]:
        import re
        vec = [0.0] * self._dim
        for tok in re.findall(r"[a-zA-Z_]+", text.lower()):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            vec[h % self._dim] += 1.0
        # L2 normalize.
        import math
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


# ---------------------------------------------------------------------------
# Auto-embedding — pick the best available backend
# ---------------------------------------------------------------------------

def auto_embeddings(prefer: str = "auto") -> Embeddings:
    """Pick the best available embeddings backend.

    Order of preference (when ``prefer="auto"``):
      1. sentence-transformers (best local semantic quality)
      2. fastembed (ONNX, no PyTorch dep)
      3. hashing (zero-dep fallback, no semantic info)

    Pass ``prefer="sentence_transformers"``, ``"fastembed"``, or
    ``"hashing"`` to force a specific backend.
    """
    if prefer == "auto":
        for backend in ("sentence_transformers", "fastembed", "hashing"):
            try:
                return auto_embeddings(prefer=backend)
            except ImportError:
                continue
        # Shouldn't happen — hashing always works.
        return HashingEmbeddings()
    if prefer in ("sentence_transformers", "st"):
        return SentenceTransformersEmbeddings()
    if prefer == "fastembed":
        return FastEmbedEmbeddings()
    if prefer == "hashing":
        return HashingEmbeddings()
    raise ValueError(f"unknown embeddings backend: {prefer!r}")
