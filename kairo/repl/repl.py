"""Interactive REPL for Kairo.

A thin readline-style loop around the Agent. Not meant to compete with
a full TUI — just enough to drive Kairo from the terminal for ad-hoc
sessions, demos, and debugging.
"""

from __future__ import annotations

import sys
from pathlib import Path

from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.syntax import Syntax

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig, load_config
from kairo.types import EventKind
from kairo.utils import configure_logging, get_event_bus

PROMPT = "kairo> "


def run_repl(
    workspace: Path,
    config: KairoConfig | None = None,
    *,
    system_prompt: str = "",
) -> None:
    """Run an interactive Kairo REPL against ``workspace``."""
    cfg = config or load_config()
    configure_logging(cfg.log_level)
    console = Console()
    console.print(Panel.fit(
        f"[bold cyan]kairo[/]  workspace=[yellow]{workspace}[/]\n"
        f"providers=[green]{', '.join(p for p, c in cfg.providers.items() if c.enabled)}[/]\n"
        f"orchestrator=[{'green' if cfg.orchestrator.enabled else 'red'}]{cfg.orchestrator.enabled}[/]",
        title="kairo",
        border_style="cyan",
    ))

    def _on_event(payload: dict) -> None:
        kind = payload.get("kind")
        if kind == EventKind.TOOL_CALL.value:
            name = payload.get("name", "?")
            console.print(f"  [dim]-> {name}({payload.get('args', {})})[/]")
        elif kind == EventKind.TOOL_RESULT.value:
            name = payload.get("name", "?")
            ok = payload.get("ok")
            tag = "[green]ok[/]" if ok else "[red]err[/]"
            console.print(f"  [dim]<- {name}[/] {tag} [dim]({payload.get('duration_s', 0):.2f}s)[/]")
        elif kind == EventKind.ROUTER_PICK.value:
            console.print(f"[magenta]router[/] -> {payload.get('model', '?')} [dim]({payload.get('reason', '')})[/]")
        elif kind == EventKind.TURN_START.value:
            console.print(f"[blue]turn {payload.get('turn')}[/] [dim]{payload.get('phase')} {payload.get('model')}[/]")

    get_event_bus().subscribe(EventKind.TOOL_CALL, _on_event)
    get_event_bus().subscribe(EventKind.TOOL_RESULT, _on_event)
    get_event_bus().subscribe(EventKind.TURN_START, _on_event)

    history: list[str] = []
    while True:
        try:
            line = input(PROMPT)
        except (EOFError, KeyboardInterrupt):
            console.print("\n[dim]bye[/]")
            break
        if not line.strip():
            continue
        if line.strip() in ("/exit", "/quit"):
            break
        if line.strip() == "/history":
            for i, h in enumerate(history, 1):
                console.print(f"  [dim]{i}.[/] {h}")
            continue
        if line.strip() == "/clear":
            history.clear()
            console.print("[dim]history cleared[/]")
            continue
        if line.startswith("/"):
            console.print(f"[red]unknown command {line!r}[/]")
            continue

        history.append(line)
        agent = Agent(cfg, AgentConfig(workspace=workspace, system_prompt=system_prompt))
        result = agent.run(line)
        # Print final assistant message.
        last_assistant = next(
            (m for m in reversed(result.messages) if m.role.value == "assistant" and m.content),
            None,
        )
        if last_assistant:
            console.print(Panel(Markdown(last_assistant.content), title="kairo", border_style="cyan"))
        console.print(
            f"[dim]{result.finish_reason}: "
            f"{len(result.turns)} turns, "
            f"{result.total_tokens} tokens, "
            f"${result.total_cost_usd:.4f}, "
            f"{result.total_duration_s:.1f}s[/]"
        )
