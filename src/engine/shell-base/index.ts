/**
 * Shell base — low-level shell operations.
 */

import { spawn, SpawnOptions } from 'child_process';

export interface ShellCommand {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Execute a shell command.
 */
export function execCommand(cmd: ShellCommand): Promise<ShellResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const options: SpawnOptions = {
      cwd: cmd.cwd,
      env: { ...process.env, ...cmd.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    const proc = spawn(cmd.command, cmd.args, options);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    let timeout: NodeJS.Timeout | undefined;
    if (cmd.timeoutMs) {
      timeout = setTimeout(() => {
        proc.kill('SIGTERM');
      }, cmd.timeoutMs);
    }

    proc.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });

    proc.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: 1,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}

/**
 * Execute a shell command and return stdout.
 */
export async function execStdout(cmd: ShellCommand): Promise<string> {
  const result = await execCommand(cmd);
  return result.stdout;
}

/**
 * Check if a command exists on the system.
 */
export async function commandExists(name: string): Promise<boolean> {
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = await execCommand({ command: which, args: [name] });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
