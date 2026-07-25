"""Shell + code execution tools.

These are the dangerous tools. They are tagged ``dangerous`` by default
so the safety layer can require explicit confirmation before each call
in interactive mode. Non-interactive runs can opt out via config.
"""

from __future__ import annotations

import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path

from kairo.errors import ToolError
from kairo.tools.base import tool
from kairo.tools.file_ops import FileToolsConfig, _safe_resolve
from kairo.utils import get_logger

log = get_logger("tools.shell")


@dataclass(slots=True)
class ShellToolsConfig:
    file_cfg: FileToolsConfig
    # Hard timeout per shell command, seconds.
    timeout_s: float = 120.0
    # Working directory for shell commands. Defaults to workspace root.
    cwd: Path | None = None
    # When True, commands are echoed back in the result.
    echo: bool = True
    # Max output bytes before truncation.
    max_output_bytes: int = 64 * 1024
    # Blocklist of substrings — any command containing one is rejected.
    # These are guardrails, not real security — use a sandbox for that.
    blocked_substrings: tuple[str, ...] = (
        "rm -rf /",
        "mkfs",
        ":(){:|:&};:",
        "dd if=/dev/zero of=/dev/",
    )


def make_shell_tools(cfg: ShellToolsConfig):
    root = cfg.file_cfg.root
    cwd = cfg.cwd or root

    def _validate(cmd: str) -> None:
        if not cmd or not cmd.strip():
            raise ToolError("shell", "empty command")
        for bad in cfg.blocked_substrings:
            if bad in cmd:
                raise ToolError("shell", f"command blocked by guardrail: contains {bad!r}")

    @tool(name="shell", tags=("dangerous",))
    def shell(command: str, timeout: float | None = None) -> str:
        """Run a shell command in the workspace.

        Args:
            command: The command line to execute. Parsed with shlex.
            timeout: Override the default timeout (seconds).

        Returns:
            ``$ <command>\\n<stdout>\\n<stderr>\\n[exit N]`` (truncated).
        """
        _validate(command)
        to = timeout if timeout is not None else cfg.timeout_s
        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=to,
                executable="/bin/bash",
            )
        except subprocess.TimeoutExpired as exc:
            raise ToolError(
                "shell",
                f"command timed out after {to}s: {command!r}",
            ) from exc
        out = proc.stdout or ""
        err = proc.stderr or ""
        if len(out) > cfg.max_output_bytes:
            out = out[: cfg.max_output_bytes] + f"\n... (truncated, {len(out) - cfg.max_output_bytes} bytes)"
        if len(err) > cfg.max_output_bytes:
            err = err[: cfg.max_output_bytes] + f"\n... (truncated, {len(err) - cfg.max_output_bytes} bytes)"
        parts = []
        if cfg.echo:
            parts.append(f"$ {command}")
        if out:
            parts.append(out.rstrip())
        if err:
            parts.append(f"[stderr]\n{err.rstrip()}")
        parts.append(f"[exit {proc.returncode}]")
        return "\n".join(parts)

    @tool(name="run_python", tags=("dangerous",))
    def run_python(code: str, timeout: float | None = None) -> str:
        """Execute a Python snippet in a fresh subprocess.

        The snippet is written to a temp file under the workspace and
        run with the same Python interpreter. Stdout + stderr are
        captured and returned.

        Args:
            code: Python source. ``sys.path`` includes the workspace root.
            timeout: Override the default timeout.
        """
        if not code or not code.strip():
            raise ToolError("run_python", "empty code")
        import tempfile, sys, os
        to = timeout if timeout is not None else cfg.timeout_s
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, dir=str(root), encoding="utf-8"
        ) as f:
            f.write(code)
            tmp_path = f.name
        try:
            env = os.environ.copy()
            env["PYTHONPATH"] = str(root) + os.pathsep + env.get("PYTHONPATH", "")
            env["PYTHONUNBUFFERED"] = "1"
            proc = subprocess.run(
                [sys.executable, tmp_path],
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=to,
                env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raise ToolError("run_python", f"python timed out after {to}s") from exc
        finally:
            try:
                Path(tmp_path).unlink()
            except OSError:
                pass
        out = proc.stdout or ""
        err = proc.stderr or ""
        if len(out) > cfg.max_output_bytes:
            out = out[: cfg.max_output_bytes] + f"\n... (truncated)"
        if len(err) > cfg.max_output_bytes:
            err = err[: cfg.max_output_bytes] + f"\n... (truncated)"
        parts = []
        if out:
            parts.append(out.rstrip())
        if err:
            parts.append(f"[stderr]\n{err.rstrip()}")
        parts.append(f"[exit {proc.returncode}]")
        return "\n".join(parts)

    return [shell, run_python]
