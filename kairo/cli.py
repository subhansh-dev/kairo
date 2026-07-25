"""Kairo CLI entrypoint.

Usage::

    kairo run "Fix the bug in src/foo.py" --workspace .
    kairo repl --workspace .
    kairo config show
    kairo models
"""

from __future__ import annotations

import sys
from pathlib import Path

import click

from kairo._version import __version__
from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig, load_config
from kairo.routing import default_catalog
from kairo.utils import configure_logging


@click.group()
@click.version_option(__version__, prog_name="kairo")
def cli() -> None:
    """Kairo — multi-model coding agent."""


@cli.command()
@click.argument("message")
@click.option("--workspace", "-w", default=".", help="Workspace root.")
@click.option("--system-prompt", "-s", default="", help="Optional system prompt.")
@click.option("--max-turns", type=int, default=None, help="Override max turns.")
@click.option("--config", "config_path", type=click.Path(), default=None, help="Config YAML.")
def run(message: str, workspace: str, system_prompt: str, max_turns: int | None,
        config_path: str | None) -> None:
    """Run Kairo once with a single message."""
    cfg = load_config(config_path)
    configure_logging(cfg.log_level)
    agent = Agent(
        cfg,
        AgentConfig(
            workspace=Path(workspace).resolve(),
            system_prompt=system_prompt,
            max_turns=max_turns,
        ),
    )
    result = agent.run(message)
    last = next(
        (m for m in reversed(result.messages) if m.role.value == "assistant" and m.content),
        None,
    )
    if last:
        click.echo(last.content)
    click.echo(
        f"[{result.finish_reason}] {len(result.turns)} turns, "
        f"{result.total_tokens} tokens, ${result.total_cost_usd:.4f}, "
        f"{result.total_duration_s:.1f}s",
        err=True,
    )
    sys.exit(0 if result.finish_reason == "complete" else 1)


@cli.command()
@click.option("--workspace", "-w", default=".", help="Workspace root.")
@click.option("--system-prompt", "-s", default="", help="Optional system prompt.")
@click.option("--config", "config_path", type=click.Path(), default=None, help="Config YAML.")
def repl(workspace: str, system_prompt: str, config_path: str | None) -> None:
    """Run an interactive Kairo REPL."""
    from kairo.repl import run_repl
    cfg = load_config(config_path)
    run_repl(Path(workspace).resolve(), cfg, system_prompt=system_prompt)


@cli.group()
def config() -> None:
    """Inspect / manage Kairo configuration."""


@config.command("show")
@click.option("--config", "config_path", type=click.Path(), default=None)
def config_show(config_path: str | None) -> None:
    """Print the active config as YAML."""
    import yaml
    cfg = load_config(config_path)
    click.echo(yaml.safe_dump(cfg.to_dict(), sort_keys=False))


@config.command("init")
@click.argument("path", type=click.Path())
def config_init(path: str) -> None:
    """Write a starter config to PATH."""
    from kairo.config import save_config, DEFAULT_CONFIG
    save_config(DEFAULT_CONFIG, path)
    click.echo(f"wrote default config to {path}")


@cli.command()
def models() -> None:
    """List models in the default catalog."""
    cat = default_catalog()
    rows = []
    for m in cat.all():
        caps = ", ".join(m.capabilities)
        rows.append(
            f"{m.provider:>10}:{m.name:<40} "
            f"ctx={m.context:>7}  "
            f"cost=${m.cost_in_per_m:.2f}/${m.cost_out_per_m:.2f}/M  "
            f"caps={caps}"
        )
    click.echo("\n".join(rows))


@cli.command()
@click.option("--workdir", "-w", default=None,
              help="Kairo workdir (defaults to ~/.kairo).")
@click.option("--limit", type=int, default=50,
              help="How many recent runs to analyze.")
def improve(workdir: str | None, limit: int) -> None:
    """Analyze past runs and print improvement suggestions."""
    from pathlib import Path
    from kairo.agent import analyze_runs, format_suggestions
    from kairo.config import load_config
    cfg = load_config()
    wd = Path(workdir) if workdir else cfg.workdir
    suggestions = analyze_runs(wd, limit=limit)
    click.echo(format_suggestions(suggestions))


@cli.command()
@click.option("--workdir", "-w", default=None,
              help="Kairo workdir (defaults to ~/.kairo).")
@click.option("--limit", type=int, default=10)
def runs(workdir: str | None, limit: int) -> None:
    """List recent persisted runs."""
    from pathlib import Path
    from kairo.agent import SessionStore
    from kairo.config import load_config
    cfg = load_config()
    wd = Path(workdir) if workdir else cfg.workdir
    store = SessionStore(wd)
    recent = store.list_runs()[-limit:]
    if not recent:
        click.echo("(no runs yet)")
        return
    for p in recent:
        try:
            data = store.load(p)
            click.echo(
                f"{p.name}  finish={data.get('finish_reason')}  "
                f"turns={len(data.get('turns', []))}  "
                f"tokens={data.get('total_tokens', 0)}"
            )
        except Exception as exc:  # noqa: BLE001
            click.echo(f"{p.name}  (unreadable: {exc})")


@cli.command()
@click.argument("suite", type=click.Path(exists=True))
@click.option("--workspace", "-w", default=None,
              help="Where to run task workspaces (defaults to /tmp/kairo-eval-<suite>).")
@click.option("--config", "config_path", type=click.Path(), default=None)
@click.option("--only", type=str, default=None,
              help="Comma-separated task ids to run (defaults to all).")
@click.option("--save", type=click.Path(), default=None,
              help="Save JSON report to this path.")
def eval(suite: str, workspace: str | None, config_path: str | None,
         only: str | None, save: str | None) -> None:
    """Run an eval suite against Kairo.

    SUITE is a directory containing tasks.json (see examples/eval-suites/).
    """
    from pathlib import Path
    from kairo.eval import format_report, run_suite
    from kairo.config import load_config
    cfg = load_config(config_path)
    suite_name = Path(suite).name
    ws = Path(workspace) if workspace else Path(f"/tmp/kairo-eval-{suite_name}")
    only_ids = only.split(",") if only else None
    report = run_suite(suite, cfg, workspace_root=ws, only_ids=only_ids)
    click.echo(format_report(report))
    if save:
        import json
        Path(save).write_text(json.dumps(report.to_dict(), indent=2))
        click.echo(f"\nReport saved to {save}")


@cli.command()
@click.argument("message")
@click.option("--workspace", "-w", default=".", help="Workspace root.")
@click.option("--system-prompt", "-s", default="", help="Optional system prompt.")
@click.option("--max-turns", type=int, default=None)
@click.option("--max-attempts", type=int, default=3,
              help="Max reflexion attempts (1 = no retry).")
@click.option("--config", "config_path", type=click.Path(), default=None)
def task(message: str, workspace: str, system_prompt: str, max_turns: int | None,
         max_attempts: int, config_path: str | None) -> None:
    """Run a task with reflexion-style retries.

    Equivalent to ``kairo run`` but automatically retries on failure
    with a verbal reflection seeded into the next attempt.
    """
    from pathlib import Path
    from kairo.agent import AgentConfig, reflexion_run
    from kairo.config import load_config
    cfg = load_config(config_path)
    result = reflexion_run(
        AgentConfig(
            workspace=Path(workspace).resolve(),
            system_prompt=system_prompt,
            max_turns=max_turns,
        ),
        cfg,
        message,
        max_attempts=max_attempts,
    )
    last = next(
        (m for m in reversed(result.final.messages)
         if m.role.value == "assistant" and m.content),
        None,
    )
    if last:
        click.echo(last.content)
    click.echo(
        f"[{'SUCCESS' if result.succeeded else 'FAILED'}] "
        f"{result.attempts_used} attempt(s), "
        f"{result.duration_s:.1f}s total",
        err=True,
    )
    sys.exit(0 if result.succeeded else 1)


@cli.command()
@click.argument("message")
@click.option("--workspace", "-w", default=".", help="Workspace root.")
@click.option("--n", type=int, default=3, help="Number of parallel approaches.")
@click.option("--strategy", type=click.Choice(
    ["first_success", "self_consistency", "critic"]), default="first_success")
@click.option("--config", "config_path", type=click.Path(), default=None)
def explore(message: str, workspace: str, n: int, strategy: str,
            config_path: str | None) -> None:
    """Tree-search a task: try N parallel approaches, pick the best.

    Useful for tasks with multiple plausible solutions (e.g. bug fixes
    where the root cause is unclear).
    """
    from pathlib import Path
    from kairo.agent.swarm import SubTask
    from kairo.agent.swarm.tree_search import tree_search
    from kairo.config import load_config
    cfg = load_config(config_path)
    subtasks = [SubTask(id=f"approach_{i+1}", prompt=message) for i in range(n)]
    result = tree_search(
        subtasks, cfg, workspace=Path(workspace).resolve(),
        strategy=strategy,
    )
    click.echo(f"Strategy: {strategy}")
    click.echo(f"Reason: {result.reason}")
    click.echo()
    last = next(
        (m for m in reversed(result.chosen.agent_result.messages)
         if m.role.value == "assistant" and m.content),
        None,
    )
    if last:
        click.echo(last.content)
    click.echo(
        f"\n[{len(result.all_results)} approaches explored, "
        f"chosen={result.chosen.subtask.id}]",
        err=True,
    )


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
