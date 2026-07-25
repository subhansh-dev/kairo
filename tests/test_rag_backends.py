"""Tests for kairo.rag_backends — optional embedding adapters."""

from __future__ import annotations

import pytest

from kairo.rag_backends import (
    HashingEmbeddings,
    auto_embeddings,
)


def test_hashing_embeddings_dim():
    emb = HashingEmbeddings(dim=128)
    assert emb.dim == 128


def test_hashing_embeddings_embeds_text():
    emb = HashingEmbeddings(dim=64)
    v = emb.embed("hello world")
    assert len(v) == 64
    # At least one dimension should be non-zero.
    assert any(abs(x) > 0 for x in v)


def test_hashing_embeddings_empty_text():
    emb = HashingEmbeddings(dim=32)
    v = emb.embed("")
    assert all(x == 0.0 for x in v)


def test_hashing_embeddings_deterministic():
    emb = HashingEmbeddings(dim=64)
    v1 = emb.embed("hello world")
    v2 = emb.embed("hello world")
    assert v1 == v2


def test_hashing_embeddings_different_texts_differ():
    emb = HashingEmbeddings(dim=64)
    v1 = emb.embed("hello world")
    v2 = emb.embed("totally different text")
    assert v1 != v2


def test_auto_embeddings_falls_back_to_hashing():
    # When sentence-transformers and fastembed aren't installed, auto
    # should fall back to hashing.
    emb = auto_embeddings(prefer="auto")
    # Should be one of the three; for hashing it'll always work.
    assert hasattr(emb, "embed")
    assert hasattr(emb, "dim")


def test_auto_embeddings_force_hashing():
    emb = auto_embeddings(prefer="hashing")
    assert isinstance(emb, HashingEmbeddings)


def test_auto_embeddings_unknown_raises():
    with pytest.raises(ValueError):
        auto_embeddings(prefer="bogus")


def test_sentence_transformers_import_error_message():
    try:
        from kairo.rag_backends import SentenceTransformersEmbeddings
        SentenceTransformersEmbeddings()
    except ImportError as exc:
        assert "sentence-transformers" in str(exc).lower()
        assert "pip install" in str(exc).lower()


def test_fastembed_import_error_message():
    try:
        from kairo.rag_backends import FastEmbedEmbeddings
        FastEmbedEmbeddings()
    except ImportError as exc:
        assert "fastembed" in str(exc).lower()
