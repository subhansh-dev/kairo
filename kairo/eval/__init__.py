"""Eval package — task-suite harness + graders."""

from kairo.eval.harness import (
    EvalResult,
    EvalTask,
    SuiteReport,
    format_report,
    grade,
    load_suite,
    register_grader,
    run_suite,
)

__all__ = [
    "EvalTask",
    "EvalResult",
    "SuiteReport",
    "load_suite",
    "run_suite",
    "grade",
    "register_grader",
    "format_report",
]
