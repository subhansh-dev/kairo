"""Tests for kairo.eval — task-suite harness + graders."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kairo.eval import (
    EvalTask,
    SuiteReport,
    format_report,
    grade,
    load_suite,
    run_suite,
)
from kairo.types import AgentResult, Message, Role


# ---------------------------------------------------------------------------
# Graders
# ---------------------------------------------------------------------------

def _make_result(text: str = "answer") -> AgentResult:
    return AgentResult(
        messages=[Message(role=Role.USER, content="q"),
                  Message(role=Role.ASSISTANT, content=text)],
        turns=[],
        finish_reason="complete",
    )


def test_grader_string_match_pass(tmp_workspace):
    task = EvalTask(id="t1", prompt="x", expected="hello",
                    check={"kind": "string_match"})
    result = _make_result("the answer is hello world")
    out = grade(tmp_workspace, result, task)
    assert out["passed"] is True


def test_grader_string_match_case_insensitive(tmp_workspace):
    task = EvalTask(id="t1", prompt="x", expected="HELLO",
                    check={"kind": "string_match", "case_sensitive": False})
    result = _make_result("hello world")
    out = grade(tmp_workspace, result, task)
    assert out["passed"] is True


def test_grader_string_match_case_sensitive(tmp_workspace):
    task = EvalTask(id="t1", prompt="x", expected="HELLO",
                    check={"kind": "string_match", "case_sensitive": True})
    result = _make_result("hello world")
    out = grade(tmp_workspace, result, task)
    assert out["passed"] is False


def test_grader_file_contains(tmp_workspace):
    (tmp_workspace / "out.txt").write_text("the answer is 42")
    task = EvalTask(id="t1", prompt="x", expected="42",
                    check={"kind": "file_contains", "path": "out.txt"})
    out = grade(tmp_workspace, None, task)
    assert out["passed"] is True


def test_grader_file_contains_missing_file(tmp_workspace):
    task = EvalTask(id="t1", prompt="x", expected="42",
                    check={"kind": "file_contains", "path": "nope.txt"})
    out = grade(tmp_workspace, None, task)
    assert out["passed"] is False
    assert "does not exist" in out["reason"]


def test_grader_file_exists(tmp_workspace):
    (tmp_workspace / "x.txt").write_text("ok")
    task = EvalTask(id="t1", prompt="x", expected=None,
                    check={"kind": "file_exists", "path": "x.txt"})
    out = grade(tmp_workspace, None, task)
    assert out["passed"] is True


def test_grader_shell_check_pass(tmp_workspace):
    task = EvalTask(id="t1", prompt="x", expected=None,
                    check={"kind": "shell_check", "command": "echo ok"})
    out = grade(tmp_workspace, None, task)
    assert out["passed"] is True


def test_grader_shell_check_fail(tmp_workspace):
    task = EvalTask(id="t1", prompt="x", expected=None,
                    check={"kind": "shell_check", "command": "exit 1"})
    out = grade(tmp_workspace, None, task)
    assert out["passed"] is False


def test_grader_shell_check_expected_code(tmp_workspace):
    task = EvalTask(id="t1", prompt="x", expected=None,
                    check={"kind": "shell_check", "command": "exit 7", "expected_code": 7})
    out = grade(tmp_workspace, None, task)
    assert out["passed"] is True


def test_grader_unknown_kind(tmp_workspace):
    task = EvalTask(id="t1", prompt="x", expected=None,
                    check={"kind": "bogus_kind"})
    out = grade(tmp_workspace, None, task)
    assert out["passed"] is False
    assert "unknown grader" in out["reason"]


# ---------------------------------------------------------------------------
# Suite loading
# ---------------------------------------------------------------------------

def test_load_suite(tmp_path: Path):
    (tmp_path / "tasks.json").write_text(json.dumps({
        "name": "test-suite",
        "tasks": [
            {"id": "t1", "prompt": "do thing", "check": {"kind": "string_match"},
             "expected": "ok"},
            {"id": "t2", "prompt": "another", "check": {"kind": "file_exists", "path": "x"}},
        ],
    }))
    name, tasks = load_suite(tmp_path)
    assert name == "test-suite"
    assert len(tasks) == 2
    assert tasks[0].id == "t1"
    assert tasks[1].check["kind"] == "file_exists"


def test_load_suite_missing_dir():
    with pytest.raises(FileNotFoundError):
        load_suite("/nonexistent/dir/xyz")


def test_load_suite_missing_tasks_json(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_suite(tmp_path)


# ---------------------------------------------------------------------------
# Suite report formatting
# ---------------------------------------------------------------------------

def test_suite_report_pass_rate():
    report = SuiteReport(suite_name="x")
    # 2 pass / 4 total = 50%
    for i in range(2):
        report.results.append(_make_eval_result(passed=True))
    for i in range(2):
        report.results.append(_make_eval_result(passed=False))
    assert report.pass_rate == 0.5


def _make_eval_result(passed: bool) -> object:
    from kairo.eval import EvalResult
    task = EvalTask(id="t", prompt="p", check={})
    return EvalResult(
        task=task,
        agent_result=_make_result(),
        passed=passed,
        metrics={},
        duration_s=1.0,
    )


def test_format_report_includes_summary():
    report = SuiteReport(suite_name="test")
    report.results.append(_make_eval_result(passed=True))
    s = format_report(report)
    assert "test" in s
    assert "100.0%" in s
    assert "PASS" in s
