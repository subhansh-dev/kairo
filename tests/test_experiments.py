"""Tests for kairo.experiments — agent versioning + A/B testing."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from kairo.experiments import (
    ABTest,
    ABTestReport,
    ABTestResult,
    AgentVersion,
    VersionRegistry,
)
from kairo.config import DEFAULT_CONFIG
from kairo.types import AgentResult, Message, Role


# ---------------------------------------------------------------------------
# AgentVersion
# ---------------------------------------------------------------------------

def test_agent_version_to_from_dict():
    v = AgentVersion(name="v1", system_prompt="Be concise.", max_turns=5)
    d = v.to_dict()
    v2 = AgentVersion.from_dict(d)
    assert v2.name == "v1"
    assert v2.system_prompt == "Be concise."
    assert v2.max_turns == 5


def test_agent_version_to_agent_config(tmp_path: Path):
    v = AgentVersion(name="v1", system_prompt="hello", max_turns=3)
    cfg = v.to_agent_config(tmp_path)
    assert cfg.workspace == tmp_path
    assert cfg.system_prompt == "hello"
    assert cfg.max_turns == 3


def test_agent_version_apply_to_kairo_config_overrides_model():
    v = AgentVersion(name="v1", provider="openai", model="gpt-4o")
    cfg = v.apply_to_kairo_config(DEFAULT_CONFIG)
    assert cfg.providers["openai"].default_model == "gpt-4o"


def test_agent_version_apply_to_kairo_config_no_override_when_provider_missing():
    v = AgentVersion(name="v1", provider="bogus", model="x")
    cfg = v.apply_to_kairo_config(DEFAULT_CONFIG)
    # Should not raise — just leaves the config unchanged.
    assert cfg is not None


# ---------------------------------------------------------------------------
# VersionRegistry
# ---------------------------------------------------------------------------

def test_registry_register_and_load(tmp_path: Path):
    reg = VersionRegistry(tmp_path / "versions")
    v = AgentVersion(name="v1", system_prompt="hello")
    reg.register(v)
    assert (tmp_path / "versions" / "v1.json").exists()
    loaded = reg.load("v1")
    assert loaded.name == "v1"
    assert loaded.system_prompt == "hello"


def test_registry_list_versions(tmp_path: Path):
    reg = VersionRegistry(tmp_path / "versions")
    reg.register(AgentVersion(name="v1"))
    reg.register(AgentVersion(name="v2"))
    reg.register(AgentVersion(name="v3"))
    versions = reg.list_versions()
    assert versions == ["v1", "v2", "v3"]


def test_registry_load_missing_raises(tmp_path: Path):
    reg = VersionRegistry(tmp_path / "versions")
    with pytest.raises(FileNotFoundError):
        reg.load("nonexistent")


def test_registry_delete(tmp_path: Path):
    reg = VersionRegistry(tmp_path / "versions")
    reg.register(AgentVersion(name="v1"))
    assert reg.delete("v1") is True
    assert reg.delete("v1") is False  # already deleted
    assert reg.list_versions() == []


# ---------------------------------------------------------------------------
# ABTest
# ---------------------------------------------------------------------------

def test_abtest_summary_empty():
    report = ABTestReport()
    s = report.summary()
    assert "A/B Test Report" in s


def test_abtest_summary_with_results():
    report = ABTestReport()
    report.version_results["v1"] = [
        ABTestResult(version_name="v1", task_id="t1", finish_reason="complete",
                     tokens=100, cost_usd=0.001, duration_s=1.0, final_text="done"),
        ABTestResult(version_name="v1", task_id="t2", finish_reason="error",
                     tokens=50, cost_usd=0.0005, duration_s=0.5, final_text="",
                     error="boom"),
    ]
    s = report.summary()
    assert "v1" in s
    assert "1/2" in s  # 1 success out of 2
    assert "t1" in s
    assert "t2" in s


def test_abtest_report_to_dict():
    report = ABTestReport()
    report.version_results["v1"] = [
        ABTestResult(version_name="v1", task_id="t1", finish_reason="complete",
                     tokens=100, cost_usd=0.001, duration_s=1.0, final_text="done"),
    ]
    d = report.to_dict()
    assert "v1" in d["version_results"]
    assert d["version_results"]["v1"][0]["task_id"] == "t1"


def test_abtest_run_with_mocked_agent(tmp_path: Path):
    """End-to-end test with mocked Agent.run."""
    reg = VersionRegistry(tmp_path / "versions")
    reg.register(AgentVersion(name="v1", system_prompt="v1 prompt"))
    reg.register(AgentVersion(name="v2", system_prompt="v2 prompt"))

    # Mock Agent to return a fake result.
    def fake_run(self, prompt):
        return AgentResult(
            messages=[Message(role=Role.USER, content=prompt),
                      Message(role=Role.ASSISTANT, content=f"response from {self.acfg.system_prompt}")],
            turns=[],
            finish_reason="complete",
            total_tokens=100,
            total_cost_usd=0.001,
            total_duration_s=0.5,
        )

    with patch("kairo.experiments.Agent") as MockAgent:
        # Mock Agent so that v1 runs return "complete", v2 runs return "error".
        # The ABTest runs versions in order: v1 (2 tasks), then v2 (2 tasks).
        # So we need: v1, v1, v2, v2 = 4 instances.
        def make_mock(version_name: str):
            m = MagicMock()
            m.run.side_effect = lambda p: AgentResult(
                messages=[Message(role=Role.ASSISTANT, content=f"{version_name} response")],
                turns=[], finish_reason="complete" if version_name == "v1" else "error",
                total_tokens=100 if version_name == "v1" else 200,
                total_cost_usd=0.001 if version_name == "v1" else 0.002,
                total_duration_s=0.5 if version_name == "v1" else 1.0,
                error=None if version_name == "v1" else "something",
            )
            return m
        # ABTest calls Agent once per (version, task). The order is:
        # v1.t1, v1.t2, v2.t1, v2.t2.
        MockAgent.side_effect = [make_mock("v1"), make_mock("v1"),
                                  make_mock("v2"), make_mock("v2")]

        ab = ABTest(DEFAULT_CONFIG, reg, workspace=tmp_path / "ab")
        report = ab.run(
            versions=["v1", "v2"],
            tasks=["task 1", "task 2"],
        )

    assert "v1" in report.version_results
    assert "v2" in report.version_results
    assert len(report.version_results["v1"]) == 2
    assert len(report.version_results["v2"]) == 2
    # v1 should have all complete; v2 all error (per our mock).
    assert all(r.finish_reason == "complete" for r in report.version_results["v1"])
    assert all(r.finish_reason == "error" for r in report.version_results["v2"])
