"""Lightweight embedding-based RAG — no external dependencies.

Real embedding models (sentence-transformers, OpenAI embeddings) give
better semantic search but require either a model download or an API
key. Kairo ships a *keyword-overlap* embedding by default so it works
out-of-the-box on any machine, and lets you plug in a real embedding
backend when you have one.

Embeddings API::

    from kairo.rag import Embeddings, VectorStore

    emb = Embeddings.default()  # keyword overlap
    store = VectorStore(emb)
    store.add("doc1", "Python is a programming language.")
    store.add("doc2", "Rust is a systems programming language.")
    results = store.search("what is python", limit=2)

For production use, swap in a real embeddings backend::

    class MyEmbeddings(Embeddings):
        def embed(self, text: str) -> list[float]:
            return call_real_embedding_api(text)
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Callable, Protocol

from kairo.utils import get_logger

log = get_logger("rag")


# ---------------------------------------------------------------------------
# Embeddings interface
# ---------------------------------------------------------------------------

class Embeddings(Protocol):
    """Embeddings backend interface."""

    def embed(self, text: str) -> list[float]:
        """Embed text into a fixed-dim float vector."""
        ...

    @property
    def dim(self) -> int:
        ...


class KeywordOverlapEmbeddings:
    """Default embeddings: TF vector over a fixed vocabulary.

    Not as good as real embeddings but zero-dependency and works
    offline. The vocabulary is built lazily from documents added to
    the store.
    """

    def __init__(self, vocab_size: int = 4096) -> None:
        self.vocab_size = vocab_size
        self._vocab: dict[str, int] = {}  # token -> index
        self._idf: dict[str, float] = {}

    @property
    def dim(self) -> int:
        return self.vocab_size

    def _tokenize(self, text: str) -> list[str]:
        return re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", text.lower())

    def fit(self, texts: list[str]) -> "KeywordOverlapEmbeddings":
        """Build vocabulary from ``texts``."""
        df: dict[str, int] = defaultdict(int)
        for text in texts:
            tokens = set(self._tokenize(text))
            for t in tokens:
                df[t] += 1
        # Sort by document frequency (most common first) and take top N.
        sorted_tokens = sorted(df.items(), key=lambda x: -x[1])[: self.vocab_size]
        self._vocab = {tok: i for i, (tok, _) in enumerate(sorted_tokens)}
        n = len(texts) or 1
        self._idf = {tok: math.log((n + 1) / (d + 1)) + 1.0 for tok, d in sorted_tokens}
        return self

    def embed(self, text: str) -> list[float]:
        if not self._vocab:
            return [0.0] * self.vocab_size
        tokens = self._tokenize(text)
        counts = Counter(tokens)
        vec = [0.0] * self.vocab_size
        for tok, cnt in counts.items():
            idx = self._vocab.get(tok)
            if idx is None:
                continue
            vec[idx] = cnt * self._idf.get(tok, 1.0)
        # L2 normalize.
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


# ---------------------------------------------------------------------------
# Vector store
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class Document:
    """A stored document."""

    id: str
    text: str
    embedding: list[float]
    metadata: dict = field(default_factory=dict)


class VectorStore:
    """In-memory vector store with cosine similarity search.

    For production scale, swap this for FAISS / Chroma / Qdrant. The
    interface is small enough to drop in any of those.
    """

    def __init__(self, embeddings: Embeddings) -> None:
        self.embeddings = embeddings
        self._docs: dict[str, Document] = {}

    def add(self, doc_id: str, text: str, **metadata) -> Document:
        emb = self.embeddings.embed(text)
        doc = Document(id=doc_id, text=text, embedding=emb, metadata=metadata)
        self._docs[doc_id] = doc
        return doc

    def add_many(self, docs: list[tuple[str, str]]) -> list[Document]:
        """Add many (id, text) pairs. Fits the embeddings vocabulary first."""
        if isinstance(self.embeddings, KeywordOverlapEmbeddings):
            self.embeddings.fit([t for _, t in docs])
        return [self.add(doc_id, text) for doc_id, text in docs]

    def remove(self, doc_id: str) -> bool:
        return self._docs.pop(doc_id, None) is not None

    def get(self, doc_id: str) -> Document | None:
        return self._docs.get(doc_id)

    def search(self, query: str, limit: int = 5, min_score: float = 0.0) -> list[tuple[float, Document]]:
        q_emb = self.embeddings.embed(query)
        scored: list[tuple[float, Document]] = []
        for doc in self._docs.values():
            score = _cosine(q_emb, doc.embedding)
            if score >= min_score:
                scored.append((score, doc))
        scored.sort(key=lambda x: -x[0])
        return scored[:limit]

    def __len__(self) -> int:
        return len(self._docs)


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


# ---------------------------------------------------------------------------
# RAG retriever
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class RagRetriever:
    """Combine a VectorStore with a formatter for agent context."""

    store: VectorStore
    # Max chars per retrieved doc.
    max_doc_chars: int = 2000
    # Max total chars in the returned context.
    max_total_chars: int = 8000

    def retrieve(self, query: str, limit: int = 5) -> str:
        results = self.store.search(query, limit=limit)
        if not results:
            return "(no relevant documents)"
        out: list[str] = []
        total = 0
        for score, doc in results:
            text = doc.text[: self.max_doc_chars]
            if total + len(text) > self.max_total_chars:
                text = text[: self.max_total_chars - total]
            out.append(f"== {doc.id} (score {score:.3f}) ==\n{text}")
            total += len(text) + 50  # rough overhead per doc
            if total >= self.max_total_chars:
                break
        return "\n\n".join(out)
