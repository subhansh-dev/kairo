"""Agent versioning + A/B testing — compare configurations head-to-head.

Production agents need versioning: when you change a system prompt,
add a tool, or swap a model, you want to know whether the new version
is actually better. This module provides:

  * :class:`AgentVersion` — a named, immutable agent configuration
    (system prompt + tool bundle config + provider config + budget).
  * :class:`VersionRegistry` — registers + persists versions.
  * :class:`ABTest` — runs two versions on the same task list and
    compares outcomes side-by-side.

Versions are serialized as JSON so they can be checked into git,
shared between teams, and rolled back.

Example::

    from kairo.experiments import AgentVersion, VersionRegistry, ABTest

    v1 = AgentVersion(name="v1", system_prompt="Be concise.")
    v2 = AgentVersion(name="v2", system_prompt="Be concise. Always verify with shell.")

    reg = VersionRegistry(Path("./versions"))
    reg.register(v1)
    reg.register(v2)

    test = ABTest(kairo_cfg, reg, workspace=Path("./ab-test"))
    report = test.run(
        versions=["v1", "v2"],
        tasks=["Fix the bug in foo.py", "Write tests for bar.py"],
    )
    print(report.summary())
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig
from kairo.eval import EvalTask, run_suite, format_report, SuiteReport
from kairo.utils import get_logger

log = get_logger("experiments")


@dataclass(slots=True)
class AgentVersion:
    """A named, immutable agent configuration.

    Captures everything that affects agent behaviour so two runs of the
    same version on the same task produce comparable results.
    """

    name: str
    system_prompt: str = ""
    persona_path: str | None = None
    max_turns: int | None = None
    # Optional: override the default model.
    provider: str | None = None
    model: str | None = None
    # Optional: tag bundles to enable/disable.
    enable_browser: bool = False
    enable_swarm: bool = False
    # Free-form metadata (version label, author, notes).
    metadata: dict[str, Any] = field(default_factory=dict)
    created_ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "AgentVersion":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})

    def to_agent_config(self, workspace: Path) -> AgentConfig:
        return AgentConfig(
            workspace=workspace,
            system_prompt=self.system_prompt,
            max_turns=self.max_turns,
            persona_path=Path(self.persona_path) if self.persona_path else None,
        )

    def apply_to_kairo_config(self, cfg: KairoConfig) -> KairoConfig:
        """Return a modified copy of cfg with this version's provider/model overrides."""
        import copy
        new_cfg = copy.deepcopy(cfg)
        if self.provider and self.model and self.provider in new_cfg.providers:
            new_cfg.providers[self.provider].default_model = self.model
        return new_cfg


class VersionRegistry:
    """Persists :class:`AgentVersion` objects to a directory.

    Each version is one JSON file: ``<dir>/<name>.json``.
    """

    def __init__(self, versions_dir: Path | str) -> None:
        self.versions_dir = Path(versions_dir)
        self.versions_dir.mkdir(parents=True, exist_ok=True)

    def register(self, version: AgentVersion) -> Path:
        path = self.versions_dir / f"{version.name}.json"
        path.write_text(json.dumps(version.to_dict(), indent=2, default=str))
        log.info("registered version %r at %s", version.name, path)
        return path

    def load(self, name: str) -> AgentVersion:
        path = self.versions_dir / f"{name}.json"
        if not path.is_file():
            raise FileNotFoundError(f"version not found: {name!r}")
        return AgentVersion.from_dict(json.loads(path.read_text()))

    def list_versions(self) -> list[str]:
        return sorted(p.stem for p in self.versions_dir.glob("*.json"))

    def delete(self, name: str) -> bool:
        path = self.versions_dir / f"{name}.json"
        if path.is_file():
            path.unlink()
            return True
        return False


# ---------------------------------------------------------------------------
# A/B testing
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ABTestResult:
    """Per-version result on a single task."""

    version_name: str
    task_id: str
    finish_reason: str
    tokens: int
    cost_usd: float
    duration_s: float
    final_text: str
    error: str | None = None


@dataclass(slots=True)
class ABTestReport:
    """Aggregate report across all versions × tasks."""

    version_results: dict[str, list[ABTestResult]] = field(default_factory=dict)
    total_duration_s: float = 0.0

    def summary(self) -> str:
        lines = ["A/B Test Report", "=" * 60]
        for version, results in self.version_results.items():
            lines.append(f"\nVersion: {version}")
            lines.append(f"  Tasks: {len(results)}")
            successes = sum(1 for r in results if r.finish_reason == "complete")
            lines.append(f"  Successes: {successes}/{len(results)}")
            avg_tokens = sum(r.tokens for r in results) / max(1, len(results))
            avg_cost = sum(r.cost_usd for r in results) / max(1, len(results))
            avg_dur = sum(r.duration_s for r in results) / max(1, len(results))
            lines.append(f"  Avg tokens: {avg_tokens:.0f}")
            lines.append(f"  Avg cost: ${avg_cost:.4f}")
            lines.append(f"  Avg duration: {avg_dur:.1f}s")
            lines.append("  Per-task:")
            for r in results:
                tag = "OK" if r.finish_reason == "complete" else "ERR"
                lines.append(f"    [{tag}] {r.task_id}: {r.tokens} tokens, {r.duration_s:.1f}s")
        lines.append(f"\nTotal duration: {self.total_duration_s:.1f}s")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "version_results": {
                v: [asdict(r) for r in rs]
                for v, rs in self.version_results.items()
            },
            "total_duration_s": self.total_duration_s,
        }


class ABTest:
    """Run two or more :class:`AgentVersion`s on the same task list.

    Each task is run by each version, in sequence. Results are aggregated
    into an :class:`ABTestReport` for comparison.
    """

    def __init__(
        self,
        kairo_cfg: KairoConfig,
        registry: VersionRegistry,
        *,
        workspace: Path,
    ) -> None:
        self.kcfg = kairo_cfg
        self.registry = registry
        self.workspace = Path(workspace)
        self.workspace.mkdir(parents=True, exist_ok=True)

    def run(
        self,
        versions: list[str],
        tasks: list[str | tuple[str, str]],
    ) -> ABTestReport:
        """Run every version on every task.

        Args:
            versions: List of version names to test.
            tasks: List of task prompts (strings) or (task_id, prompt) tuples.

        Returns:
            :class:`ABTestReport` with per-version results.
        """
        start = time.time()
        report = ABTestReport()
        # Normalize tasks.
        norm_tasks: list[tuple[str, str]] = []
        for t in tasks:
            if isinstance(t, str):
                norm_tasks.append((f"task_{len(norm_tasks) + 1}", t))
            else:
                norm_tasks.append(t)

        for version_name in versions:
            version = self.registry.load(version_name)
            kcfg = version.apply_to_kairo_config(self.kcfg)
            report.version_results[version_name] = []
            for task_id, prompt in norm_tasks:
                task_ws = self.workspace / version_name / task_id
                if task_ws.exists():
                    import shutil
                    shutil.rmtree(task_ws)
                task_ws.mkdir(parents=True)
                log.info("ABTest: version=%s task=%s", version_name, task_id)
                agent = Agent(kcfg, version.to_agent_config(task_ws))
                result = agent.run(prompt)
                final = ""
                for m in reversed(result.messages):
                    if m.role.value == "assistant" and m.content:
                        final = m.content
                        break
                report.version_results[version_name].append(ABTestResult(
                    version_name=version_name,
                    task_id=task_id,
                    finish_reason=result.finish_reason,
                    tokens=result.total_tokens,
                    cost_usd=result.total_cost_usd,
                    duration_s=result.total_duration_s,
                    final_text=final,
                    error=result.error,
                ))
        report.total_duration_s = time.time() - start
        return report

    def run_with_eval(
        self,
        versions: list[str],
        eval_suite_dir: str | Path,
    ) -> ABTestReport:
        """Run versions against an eval suite (with graders).

        Each version runs the full suite; the report includes pass/fail.
        """
        from kairo.eval import load_suite
        suite_name, tasks = load_suite(eval_suite_dir)
        start = time.time()
        report = ABTestReport()
        # Convert eval tasks to (id, prompt) tuples for the simple run path.
        norm_tasks = [(t.id, t.prompt) for t in tasks]
        # Run + grade each version.
        for version_name in versions:
            version = self.registry.load(version_name)
            kcfg = version.apply_to_kairo_config(self.kcfg)
            report.version_results[version_name] = []
            for task in tasks:
                task_ws = self.workspace / version_name / task.id
                if task_ws.exists():
                    import shutil
                    shutil.rmtree(task_ws)
                task_ws.mkdir(parents=True)
                agent = Agent(kcfg, version.to_agent_config(task_ws))
                result = agent.run(task.prompt)
                from kairo.eval import grade
                grade_result = grade(task_ws, result, task)
                final = ""
                for m in reversed(result.messages):
                    if m.role.value == "assistant" and m.content:
                        final = m.content
                        break
                report.version_results[version_name].append(ABTestResult(
                    version_name=version_name,
                    task_id=task.id,
                    finish_reason=result.finish_reason if grade_result.get("passed") else "failed",
                    tokens=result.total_tokens,
                    cost_usd=result.total_cost_usd,
                    duration_s=result.total_duration_s,
                    final_text=final,
                    error=result.error,
                ))
        report.total_duration_s = time.time() - start
        return report
