"""Pytest configuration + shared fixtures for the Kairo test suite."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Make `import kairo` work without install.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture
def tmp_workspace() -> Path:
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


@pytest.fixture
def fake_env(monkeypatch):
    """Set fake API keys for every provider so config doesn't bail."""
    for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
              "ZAI_API_KEY"):
        monkeypatch.setenv(k, f"fake-{k.lower()}")
    return monkeypatch
