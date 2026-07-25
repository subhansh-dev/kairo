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
@click.option("--persona", "persona_path", type=click.Path(exists=True), default=None,
              help="Path to a soul.md persona file.")
@click.option("--preset", type=click.Choice([
    "coding-agent", "research-agent", "data-analyst", "reviewer", "minimal",
]), default=None, help="Use a built-in preset (overrides --system-prompt).")
@click.option("--max-turns", type=int, default=None)
@click.option("--config", "config_path", type=click.Path(), default=None)
def run(message: str, workspace: str, system_prompt: str, persona_path: str | None,
        preset: str | None, max_turns: int | None, config_path: str | None) -> None:
    """Run Kairo once with a single message."""
    cfg = load_config(config_path)
    configure_logging(cfg.log_level)
    # Apply preset if specified.
    if preset:
        from kairo.presets import get_preset
        p = get_preset(preset)
        cfg = p.apply_to_kairo_config(cfg)
        system_prompt = p.persona_body
        if max_turns is None:
            max_turns = p.max_turns
    agent = Agent(
        cfg,
        AgentConfig(
            workspace=Path(workspace).resolve(),
            system_prompt=system_prompt,
            max_turns=max_turns,
            persona_path=Path(persona_path) if persona_path else None,
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
def presets() -> None:
    """List built-in agent presets."""
    from kairo.presets import PRESETS
    for name, p in PRESETS.items():
        click.echo(f"  {name:<20}  {p.description}")


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


@cli.command()
@click.option("--persona", "persona_path", type=click.Path(exists=True),
              default="soul.md", help="Path to a soul.md file.")
def soul(persona_path: str | None) -> None:
    """Print the active persona / system prompt."""
    from kairo.agent import load_persona, default_persona
    from pathlib import Path
    if persona_path and Path(persona_path).is_file():
        p = load_persona(persona_path)
    else:
        p = default_persona()
    click.echo(p.system_prompt(with_metadata=True))


@cli.command()
@click.option("--workdir", "-w", default=None,
              help="Kairo workdir (defaults to ~/.kairo).")
def learning(workdir: str | None) -> None:
    """Show stats from the learning graph."""
    from pathlib import Path
    from kairo.agent import LearningGraph
    from kairo.config import load_config
    import json
    cfg = load_config()
    wd = Path(workdir) if workdir else cfg.workdir
    g = LearningGraph.load(wd)
    stats = g.stats()
    click.echo(json.dumps(stats, indent=2, default=str))


@cli.command()
@click.option("--host", default="127.0.0.1", help="Bind host.")
@click.option("--dashboard-port", type=int, default=8080,
              help="Dashboard port.")
@click.option("--metrics-port", type=int, default=9090,
              help="Prometheus metrics port.")
@click.option("--otlp-endpoint", type=str, default=None,
              help="Optional OTLP collector endpoint (e.g. http://localhost:4317).")
@click.option("--webhook-url", type=str, default=None,
              help="Optional webhook URL to forward events to.")
@click.option("--config", "config_path", type=click.Path(), default=None)
def serve(host: str, dashboard_port: int, metrics_port: int,
          otlp_endpoint: str | None, webhook_url: str | None,
          config_path: str | None) -> None:
    """Start all Kairo servers: dashboard, metrics, OTLP exporter, webhooks.

    Useful for production deployments and long-running sessions.
    Press Ctrl+C to stop.
    """
    from pathlib import Path
    from kairo.config import load_config
    from kairo.observability import (
        DashboardServer, MetricsCollector, MetricsServer,
        OTLPConfig, OTLPExporter,
    )
    from kairo.observability.webhooks import WebhookDispatcher, WebhookSubscription

    cfg = load_config(config_path)
    servers: list = []
    exporters: list = []
    webhook_dispatcher: WebhookDispatcher | None = None

    # Dashboard
    dashboard = DashboardServer(workdir=cfg.workdir, host=host, port=dashboard_port)
    dashboard_url = dashboard.start()
    servers.append(dashboard)
    click.echo(f"Dashboard: {dashboard_url}")

    # Metrics
    collector = MetricsCollector.default()
    metrics_server = MetricsServer(collector, host=host, port=metrics_port)
    metrics_url = metrics_server.start()
    servers.append(metrics_server)
    click.echo(f"Metrics:   {metrics_url}/metrics")

    # OTLP exporter (optional)
    if otlp_endpoint:
        otlp = OTLPExporter(OTLPConfig(endpoint=otlp_endpoint))
        otlp.start()
        exporters.append(otlp)
        click.echo(f"OTLP:      {otlp_endpoint}")

    # Webhook (optional)
    if webhook_url:
        webhook_dispatcher = WebhookDispatcher()
        webhook_dispatcher.add(WebhookSubscription(url=webhook_url))
        webhook_dispatcher.start()
        click.echo(f"Webhook:   {webhook_url}")

    click.echo("\nPress Ctrl+C to stop all servers.")
    try:
        import time
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        click.echo("\nStopping servers...")
    finally:
        for s in servers:
            s.stop()
        for e in exporters:
            e.stop()
        if webhook_dispatcher:
            webhook_dispatcher.stop()


@cli.command()
@click.option("--host", default="0.0.0.0", help="Bind host.")
@click.option("--port", "-p", type=int, default=8000, help="API server port.")
@click.option("--config", "config_path", type=click.Path(), default=None)
def api(host: str, port: int, config_path: str | None) -> None:
    """Start the Kairo REST API server.

    Exposes endpoints for starting agent runs, listing runs, managing
    tenants, and scraping Prometheus metrics. See kairo.api.APIServer
    for the full API spec.
    """
    from kairo.api import APIServer
    from kairo.config import load_config
    cfg = load_config(config_path)
    server = APIServer(workdir=cfg.workdir, kairo_cfg=cfg, host=host, port=port)
    url = server.start()
    click.echo(f"Kairo API server running at {url}")
    click.echo(f"  Health:  {url}/health")
    click.echo(f"  Metrics: {url}/metrics")
    click.echo(f"  Models:  {url}/api/models")
    click.echo(f"  Presets: {url}/api/presets")
    click.echo("\nPress Ctrl+C to stop.")
    try:
        import time
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        click.echo("\nStopping...")
        server.stop()


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
