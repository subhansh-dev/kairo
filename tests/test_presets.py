"""Tests for kairo.presets — ready-to-use agent configurations."""

from __future__ import annotations

from pathlib import Path

import pytest

from kairo.config import DEFAULT_CONFIG
from kairo.presets import (
    CODING_AGENT,
    DATA_ANALYST,
    MINIMAL,
    PRESETS,
    RESEARCH_AGENT,
    REVIEWER,
    Preset,
    get_preset,
    list_presets,
)


def test_list_presets_returns_all():
    presets = list_presets()
    assert "coding-agent" in presets
    assert "research-agent" in presets
    assert "data-analyst" in presets
    assert "reviewer" in presets
    assert "minimal" in presets


def test_get_preset_returns_preset():
    p = get_preset("coding-agent")
    assert isinstance(p, Preset)
    assert p.name == "coding-agent"


def test_get_preset_unknown_raises():
    with pytest.raises(KeyError, match="unknown preset"):
        get_preset("bogus")


def test_coding_agent_enables_swe_and_shell():
    p = CODING_AGENT
    assert p.enable_swe is True
    assert p.enable_shell is True
    assert p.enable_edit is True


def test_research_agent_disables_edit_and_shell():
    p = RESEARCH_AGENT
    assert p.enable_edit is False
    assert p.enable_shell is False
    assert p.enable_web is True
    assert p.enable_code_rag is True


def test_data_analyst_enables_run_python_via_shell():
    p = DATA_ANALYST
    assert p.enable_shell is True  # run_python is in the shell bundle
    assert p.enable_web is False


def test_reviewer_disables_edit_and_shell():
    p = REVIEWER
    assert p.enable_edit is False
    assert p.enable_shell is False
    assert p.enable_swe is True  # read-only SWE tools


def test_minimal_only_file_and_edit():
    p = MINIMAL
    assert p.enable_file is True
    assert p.enable_edit is True
    assert p.enable_search is False
    assert p.enable_shell is False
    assert p.enable_web is False
    assert p.enable_swe is False


def test_preset_to_persona():
    p = CODING_AGENT
    persona = p.to_persona()
    assert persona.name == "coding-agent"
    assert "Kairo" in persona.body
    assert persona.metadata.get("preset") == "coding-agent"


def test_preset_to_agent_config(tmp_path: Path):
    p = CODING_AGENT
    cfg = p.to_agent_config(tmp_path)
    assert cfg.workspace == tmp_path
    assert cfg.max_turns == 40
    assert "Kairo" in cfg.system_prompt


def test_preset_to_bundle_config(tmp_path: Path):
    p = REVIEWER
    bundle = p.to_bundle_config(tmp_path)
    assert bundle.enable_edit is False
    assert bundle.enable_shell is False
    assert bundle.enable_swe is True


def test_preset_apply_to_kairo_config_overrides_model():
    p = Preset(
        name="test", description="d", persona_body="b",
        prefer_provider="openai", prefer_model="gpt-4o",
    )
    cfg = p.apply_to_kairo_config(DEFAULT_CONFIG)
    assert cfg.providers["openai"].default_model == "gpt-4o"
    assert cfg.router.default_model == "openai:gpt-4o"


def test_preset_apply_to_kairo_config_overrides_max_turns():
    p = Preset(name="test", description="d", persona_body="b", max_turns=99)
    cfg = p.apply_to_kairo_config(DEFAULT_CONFIG)
    assert cfg.safety.max_turns == 99


def test_preset_apply_to_kairo_config_no_override_when_provider_missing():
    p = Preset(
        name="test", description="d", persona_body="b",
        prefer_provider="bogus", prefer_model="x",
    )
    cfg = p.apply_to_kairo_config(DEFAULT_CONFIG)
    # Should not crash; just leaves config unchanged.
    assert cfg is not None


def test_all_presets_in_registry():
    """Every built-in preset is registered in PRESETS."""
    for preset in (CODING_AGENT, RESEARCH_AGENT, DATA_ANALYST, REVIEWER, MINIMAL):
        assert preset.name in PRESETS
        assert PRESETS[preset.name] is preset


def test_preset_persona_bodies_are_nonempty():
    for name in list_presets():
        p = get_preset(name)
        assert len(p.persona_body) > 50, f"preset {name} has empty persona"
