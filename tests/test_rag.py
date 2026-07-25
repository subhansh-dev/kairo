"""Tests for kairo.rag — embeddings + vector store."""

from __future__ import annotations

import pytest

from kairo.rag import (
    KeywordOverlapEmbeddings,
    RagRetriever,
    VectorStore,
)


def test_keyword_embeddings_fit_then_embed():
    emb = KeywordOverlapEmbeddings(vocab_size=10)
    emb.fit(["python is great", "rust is fast", "python and rust"])
    # Embed should produce a vector of size vocab_size.
    v = emb.embed("python is great")
    assert len(v) == 10
    # Non-zero (since the words appear in vocab).
    assert any(abs(x) > 0 for x in v)


def test_keyword_embeddings_empty_text():
    emb = KeywordOverlapEmbeddings(vocab_size=10)
    emb.fit(["some text here"])
    v = emb.embed("")
    assert all(x == 0.0 for x in v)


def test_keyword_embeddings_unknown_words():
    emb = KeywordOverlapEmbeddings(vocab_size=10)
    emb.fit(["python is great"])
    v = emb.embed("completely_unknown_word")
    # All zeros since the word isn't in vocab.
    assert all(x == 0.0 for x in v)


def test_vector_store_add_and_search():
    emb = KeywordOverlapEmbeddings(vocab_size=100)
    store = VectorStore(emb)
    store.add_many([
        ("d1", "Python is a programming language"),
        ("d2", "Rust is a systems programming language"),
        ("d3", "The cat sat on the mat"),
    ])
    results = store.search("programming language", limit=2)
    assert len(results) >= 1
    # Top result should be about programming.
    assert results[0][1].id in ("d1", "d2")


def test_vector_store_search_no_results():
    emb = KeywordOverlapEmbeddings(vocab_size=100)
    store = VectorStore(emb)
    store.add_many([("d1", "hello world")])
    # Query with completely different words.
    results = store.search("zzz unknown zzz", min_score=0.5)
    # No matches above threshold.
    assert results == []


def test_vector_store_remove():
    emb = KeywordOverlapEmbeddings(vocab_size=100)
    store = VectorStore(emb)
    store.add_many([("d1", "hello"), ("d2", "world")])
    assert len(store) == 2
    assert store.remove("d1") is True
    assert len(store) == 1
    assert store.remove("nonexistent") is False


def test_vector_store_get():
    emb = KeywordOverlapEmbeddings(vocab_size=100)
    store = VectorStore(emb)
    store.add_many([("d1", "hello world")])
    doc = store.get("d1")
    assert doc is not None
    assert doc.text == "hello world"


def test_rag_retriever_returns_context():
    emb = KeywordOverlapEmbeddings(vocab_size=100)
    store = VectorStore(emb)
    store.add_many([
        ("d1", "Python is a programming language"),
        ("d2", "Rust is a systems programming language"),
    ])
    rag = RagRetriever(store=store)
    out = rag.retrieve("programming language", limit=2)
    assert "d1" in out or "d2" in out


def test_rag_retriever_empty_store():
    emb = KeywordOverlapEmbeddings(vocab_size=100)
    store = VectorStore(emb)
    rag = RagRetriever(store=store)
    out = rag.retrieve("anything")
    assert "no relevant" in out.lower()


def test_rag_retriever_respects_max_chars():
    emb = KeywordOverlapEmbeddings(vocab_size=100)
    store = VectorStore(emb)
    store.add_many([("d1", "x" * 5000)])
    rag = RagRetriever(store=store, max_total_chars=100)
    out = rag.retrieve("x", limit=1)
    # Should be truncated.
    assert len(out) < 5000
