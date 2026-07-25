"""Tests for kairo.config — load/save/merge."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from kairo.config import (
    DEFAULT_CONFIG,
    KairoConfig,
    ProviderConfig,
    SafetyConfig,
    load_config,
    save_config,
)


def test_default_config_has_all_providers():
    cfg = DEFAULT_CONFIG
    for name in ("openai", "anthropic", "openrouter", "ollama", "glm", "hermes_xml"):
        assert name in cfg.providers


def test_save_and_load_round_trip(tmp_path: Path):
    cfg = KairoConfig()
    cfg.safety.max_turns = 42
    cfg.router.default_model = "openai:gpt-4o"
    p = tmp_path / "cfg.yaml"
    save_config(cfg, p)
    loaded = load_config(p)
    assert loaded.safety.max_turns == 42
    assert loaded.router.default_model == "openai:gpt-4o"


def test_load_partial_yaml_merges_with_defaults(tmp_path: Path):
    p = tmp_path / "cfg.yaml"
    p.write_text(yaml.safe_dump({
        "safety": {"max_turns": 99},
        "providers": {"openai": {"enabled": False}},
    }))
    cfg = load_config(p)
    assert cfg.safety.max_turns == 99
    assert cfg.providers["openai"].enabled is False
    # Other providers should retain their defaults.
    assert cfg.providers["anthropic"].enabled is True


def test_env_overrides(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("KAIRO_LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("KAIRO_MAX_TURNS", "7")
    cfg = load_config(None)
    assert cfg.log_level == "DEBUG"
    assert cfg.safety.max_turns == 7


def test_env_max_turns_invalid(monkeypatch):
    monkeypatch.setenv("KAIRO_MAX_TURNS", "not-an-int")
    from kairo.errors import ConfigError
    with pytest.raises(ConfigError):
        load_config(None)


def test_provider_api_key_from_env(monkeypatch):
    monkeypatch.setenv("MY_TEST_KEY", "sk-secret")
    pc = ProviderConfig(api_key_env="MY_TEST_KEY")
    assert pc.api_key() == "sk-secret"


def test_provider_api_key_missing_returns_none():
    pc = ProviderConfig(api_key_env="DOES_NOT_EXIST_VAR_XYZ")
    assert pc.api_key() is None
