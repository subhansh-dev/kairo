"""Kairo eval harness — benchmark the agent against task suites.

Inspired by retrieval-benchmark harnesses (one entry point, per-task
timing, error capture, per-task metrics, aggregate tables), but
adapted for *agentic* evals where the agent gets a task, runs its
loop with tools, and produces an artifact that is graded.

A "task suite" is a directory containing:

  ``tasks.json``  — list of ``{"id","prompt","expected","check"}``
  ``setup.py``    — optional: called before each task to seed workspace
  ``graders/``    — optional: per-task grading functions

A "grader" takes ``(workspace: Path, agent_result: AgentResult, task: dict)``
and returns a dict of metrics (e.g. ``{"passed": True, "tokens": 1234}``).

Built-in graders:
  * ``string_match`` — agent's final text contains task["expected"]
  * ``file_contains`` — file at task["check"]["path"] contains expected
  * ``file_exists`` — file at task["check"]["path"] exists
  * ``shell_check`` — run a shell command, pass if exit code is 0
  * ``pytest_check`` — run ``pytest <path>``, pass if all tests pass

Run ``kairo eval --suite examples/eval-suite --workspace /tmp/kairo-eval``
to execute a suite.
"""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig
from kairo.types import AgentResult, Role
from kairo.utils import get_logger

log = get_logger("eval")


# ---------------------------------------------------------------------------
# Task + Suite types
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class EvalTask:
    """One task in an eval suite."""

    id: str
    prompt: str
    # Free-form grader config. Must include a "kind" key.
    check: dict[str, Any]
    expected: str | None = None
    # Optional max_turns override.
    max_turns: int | None = None
    # Optional per-task system prompt.
    system_prompt: str | None = None


@dataclass(slots=True)
class EvalResult:
    """Result of running one task."""

    task: EvalTask
    agent_result: AgentResult | None
    passed: bool
    metrics: dict[str, Any]
    duration_s: float
    error: str | None = None


@dataclass(slots=True)
class SuiteReport:
    """Aggregate report across all tasks in a suite."""

    suite_name: str
    results: list[EvalResult] = field(default_factory=list)
    total_duration_s: float = 0.0

    @property
    def pass_rate(self) -> float:
        if not self.results:
            return 0.0
        return sum(1 for r in self.results if r.passed) / len(self.results)

    @property
    def avg_tokens(self) -> float:
        if not self.results:
            return 0.0
        return sum(r.agent_result.total_tokens if r.agent_result else 0
                   for r in self.results) / len(self.results)

    @property
    def avg_duration_s(self) -> float:
        if not self.results:
            return 0.0
        return sum(r.duration_s for r in self.results) / len(self.results)

    def to_dict(self) -> dict[str, Any]:
        return {
            "suite_name": self.suite_name,
            "task_count": len(self.results),
            "pass_rate": round(self.pass_rate, 4),
            "avg_tokens": round(self.avg_tokens, 1),
            "avg_duration_s": round(self.avg_duration_s, 2),
            "total_duration_s": round(self.total_duration_s, 2),
            "results": [
                {
                    "task_id": r.task.id,
                    "passed": r.passed,
                    "metrics": r.metrics,
                    "duration_s": round(r.duration_s, 2),
                    "tokens": r.agent_result.total_tokens if r.agent_result else 0,
                    "finish_reason": r.agent_result.finish_reason if r.agent_result else None,
                    "error": r.error,
                }
                for r in self.results
            ],
        }


# ---------------------------------------------------------------------------
# Suite loading
# ---------------------------------------------------------------------------

def load_suite(suite_dir: str | Path) -> tuple[str, list[EvalTask]]:
    """Load a task suite from a directory.

    The directory must contain ``tasks.json``. Each entry must have
    ``id``, ``prompt``, and ``check`` (with ``check.kind``).
    """
    suite_dir = Path(suite_dir)
    if not suite_dir.is_dir():
        raise FileNotFoundError(f"suite dir not found: {suite_dir}")
    tasks_file = suite_dir / "tasks.json"
    if not tasks_file.is_file():
        raise FileNotFoundError(f"tasks.json not found in {suite_dir}")
    data = json.loads(tasks_file.read_text())
    suite_name = data.get("name", suite_dir.name)
    tasks = []
    for raw in data.get("tasks", []):
        tasks.append(EvalTask(
            id=str(raw["id"]),
            prompt=str(raw["prompt"]),
            check=raw.get("check", {}) or {},
            expected=raw.get("expected"),
            max_turns=raw.get("max_turns"),
            system_prompt=raw.get("system_prompt"),
        ))
    return suite_name, tasks


# ---------------------------------------------------------------------------
# Graders
# ---------------------------------------------------------------------------

Grader = Callable[[Path, AgentResult | None, EvalTask], dict[str, Any]]

_GRADERS: dict[str, Grader] = {}


def register_grader(name: str) -> Callable[[Grader], Grader]:
    def _wrap(fn: Grader) -> Grader:
        _GRADERS[name] = fn
        return fn
    return _wrap


@register_grader("string_match")
def _grader_string_match(workspace: Path, result: AgentResult | None, task: EvalTask) -> dict:
    """Pass if the agent's final assistant text contains ``task["expected"]``."""
    if result is None:
        return {"passed": False, "reason": "no agent result"}
    needle = task.expected or task.check.get("contains") or ""
    if not needle:
        return {"passed": False, "reason": "no expected string configured"}
    last = ""
    for m in reversed(result.messages):
        if m.role == Role.ASSISTANT and m.content:
            last = m.content
            break
    case_sensitive = task.check.get("case_sensitive", False)
    if case_sensitive:
        passed = needle in last
    else:
        passed = needle.lower() in last.lower()
    return {"passed": passed, "reason": "matched" if passed else f"expected {needle!r} not in final text"}


@register_grader("file_contains")
def _grader_file_contains(workspace: Path, result: AgentResult | None, task: EvalTask) -> dict:
    """Pass if a file contains the expected string."""
    path = task.check.get("path")
    needle = task.expected or task.check.get("contains") or ""
    if not path or not needle:
        return {"passed": False, "reason": "missing path or contains in check config"}
    p = Path(path)
    if not p.is_absolute():
        p = workspace / p
    if not p.exists():
        return {"passed": False, "reason": f"file {p} does not exist"}
    text = p.read_text(encoding="utf-8", errors="replace")
    passed = needle in text
    return {"passed": passed, "reason": "found" if passed else "not found"}


@register_grader("file_exists")
def _grader_file_exists(workspace: Path, result: AgentResult | None, task: EvalTask) -> dict:
    """Pass if a file exists."""
    path = task.check.get("path")
    if not path:
        return {"passed": False, "reason": "missing path in check config"}
    p = Path(path)
    if not p.is_absolute():
        p = workspace / p
    passed = p.exists()
    return {"passed": passed, "reason": str(p)}


@register_grader("shell_check")
def _grader_shell_check(workspace: Path, result: AgentResult | None, task: EvalTask) -> dict:
    """Run a shell command; pass if exit code is 0 (or matches ``expected_code``)."""
    cmd = task.check.get("command")
    if not cmd:
        return {"passed": False, "reason": "missing command in check config"}
    expected_code = task.check.get("expected_code", 0)
    try:
        proc = subprocess.run(
            cmd, shell=True, cwd=str(workspace),
            capture_output=True, text=True, timeout=30,
        )
    except subprocess.TimeoutExpired:
        return {"passed": False, "reason": "command timed out"}
    passed = proc.returncode == expected_code
    return {
        "passed": passed,
        "reason": f"exit={proc.returncode}",
        "stdout": proc.stdout[:500],
        "stderr": proc.stderr[:500],
    }


@register_grader("pytest_check")
def _grader_pytest_check(workspace: Path, result: AgentResult | None, task: EvalTask) -> dict:
    """Run pytest on a path; pass if all tests pass."""
    target = task.check.get("path", ".")
    try:
        proc = subprocess.run(
            ["python", "-m", "pytest", target, "-q", "--tb=line"],
            cwd=str(workspace),
            capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        return {"passed": False, "reason": "pytest timed out"}
    passed = proc.returncode == 0
    # Pull the summary line.
    summary = ""
    for line in reversed(proc.stdout.splitlines()):
        if "passed" in line or "failed" in line:
            summary = line.strip()
            break
    return {
        "passed": passed,
        "reason": summary or f"exit={proc.returncode}",
        "stdout": proc.stdout[-1000:],
    }


def grade(workspace: Path, result: AgentResult | None, task: EvalTask) -> dict[str, Any]:
    """Run the grader specified in ``task.check["kind"]``."""
    kind = task.check.get("kind", "string_match")
    grader = _GRADERS.get(kind)
    if grader is None:
        return {"passed": False, "reason": f"unknown grader kind: {kind!r}"}
    try:
        return grader(workspace, result, task)
    except Exception as exc:  # noqa: BLE001
        return {"passed": False, "reason": f"grader crashed: {exc}"}


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_suite(
    suite_dir: str | Path,
    kairo_cfg: KairoConfig,
    *,
    workspace_root: Path,
    only_ids: list[str] | None = None,
    setup_per_task: bool = True,
) -> SuiteReport:
    """Run every task in a suite.

    Each task gets a fresh workspace under ``workspace_root/<task_id>/``.
    """
    suite_name, tasks = load_suite(suite_dir)
    if only_ids:
        tasks = [t for t in tasks if t.id in only_ids]
    workspace_root.mkdir(parents=True, exist_ok=True)

    report = SuiteReport(suite_name=suite_name)
    suite_start = time.time()

    # Optional suite-level setup.
    setup_script = Path(suite_dir) / "setup.py"
    setup_fn: Callable[[Path, EvalTask], None] | None = None
    if setup_per_task and setup_script.is_file():
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("suite_setup", setup_script)
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                setup_fn = getattr(mod, "setup_task", None)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not load setup.py: %s", exc)

    for task in tasks:
        task_ws = workspace_root / task.id
        if task_ws.exists():
            # Clean previous run.
            import shutil
            shutil.rmtree(task_ws)
        task_ws.mkdir(parents=True)
        if setup_fn is not None:
            try:
                setup_fn(task_ws, task)
            except Exception as exc:  # noqa: BLE001
                log.warning("setup_task(%s) failed: %s", task.id, exc)

        log.info("running task %s: %s", task.id, task.prompt[:80])
        start = time.time()
        agent_result: AgentResult | None = None
        error: str | None = None
        try:
            agent = Agent(
                kairo_cfg,
                AgentConfig(
                    workspace=task_ws,
                    system_prompt=task.system_prompt or "",
                    max_turns=task.max_turns,
                ),
            )
            agent_result = agent.run(task.prompt)
        except Exception as exc:  # noqa: BLE001
            error = f"{type(exc).__name__}: {exc}"
            log.exception("task %s crashed", task.id)

        metrics = grade(task_ws, agent_result, task)
        result = EvalResult(
            task=task,
            agent_result=agent_result,
            passed=metrics.get("passed", False),
            metrics=metrics,
            duration_s=time.time() - start,
            error=error,
        )
        report.results.append(result)
        log.info("task %s: %s (%.1fs)", task.id,
                 "PASS" if result.passed else "FAIL", result.duration_s)

    report.total_duration_s = time.time() - suite_start
    return report


def format_report(report: SuiteReport) -> str:
    """Pretty-print a suite report for the CLI."""
    lines = [
        f"Suite: {report.suite_name}",
        f"  Tasks:     {len(report.results)}",
        f"  Pass rate: {report.pass_rate:.1%}",
        f"  Avg tokens: {report.avg_tokens:.0f}",
        f"  Avg duration: {report.avg_duration_s:.1f}s",
        f"  Total duration: {report.total_duration_s:.1f}s",
        "",
        "Per-task results:",
    ]
    for r in report.results:
        tag = "PASS" if r.passed else "FAIL"
        reason = r.metrics.get("reason", "")
        lines.append(f"  [{tag}] {r.task.id}  ({r.duration_s:.1f}s)  {reason}")
    return "\n".join(lines)
