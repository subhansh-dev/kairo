/**
 * Kairo — Process Management
 * Wraps child_process with signals, timeouts, output streaming, and lifecycle
 */

import { spawn, execSync, type SpawnOptions, type ChildProcess } from 'child_process';

// ─── Process Result ─────────────────────────────────────────────

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
  duration: number;
}

export interface ProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  maxBuffer?: number;
  shell?: boolean | string;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

// ─── Spawn Process ──────────────────────────────────────────────

export function spawnProcess(options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const spawnOptions: SpawnOptions = {
      cwd: options.cwd || process.cwd(),
      env: options.env || (process.env as Record<string, string>),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: options.shell ?? true,
    };

    let child: ChildProcess;
    try {
      child = spawn(options.command, options.args || [], spawnOptions);
    } catch (e: any) {
      const duration = Date.now() - startTime;
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: e.message,
        duration,
      });
      return;
    }

    // Handle stdout
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        chunks.push(data);
        if (options.onStdout) {
          options.onStdout(data.toString('utf-8'));
        }
      });
    }

    // Handle stderr
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        errChunks.push(data);
        if (options.onStderr) {
          options.onStderr(data.toString('utf-8'));
        }
      });
    }

    // Handle timeout
    if (options.timeout && options.timeout > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Force kill after grace period
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 2000);
      }, options.timeout);
    }

    // Handle abort signal
    let abortHandler: (() => void) | null = null;
    if (options.signal) {
      if (options.signal.aborted) {
        child.kill('SIGTERM');
        const duration = Date.now() - startTime;
        resolve({ exitCode: -1, stdout: '', stderr: 'Cancelled.', signal: 'SIGTERM', duration });
        return;
      }
      abortHandler = () => {
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 2000);
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    // Handle exit
    child.on('close', (exitCode: number | null, signal: string | null) => {
      if (killTimer) clearTimeout(killTimer);
      // Clean up abort signal listener to prevent memory leak
      if (abortHandler && options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      const duration = Date.now() - startTime;

      const stdout = Buffer.concat(chunks).toString('utf-8');
      const stderr = Buffer.concat(errChunks).toString('utf-8');

      resolve({
        exitCode: timedOut ? -1 : (exitCode ?? -1),
        stdout: stdout,
        stderr: timedOut ? `Timed out after ${options.timeout}ms\n` + stderr : stderr,
        signal: signal ?? undefined,
        duration,
      });
    });

    // Handle error
    child.on('error', (err: Error) => {
      if (killTimer) clearTimeout(killTimer);
      const duration = Date.now() - startTime;
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        duration,
      });
    });
  });
}

// ─── Simple Exec Wrapper ────────────────────────────────────────

export interface ExecOptions {
  cwd?: string;
  encoding?: BufferEncoding;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export function safeExec(
  command: string,
  options: ExecOptions = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(command, {
      cwd: options.cwd || process.cwd(),
      encoding: options.encoding || 'utf-8' as const,
      timeout: options.timeout || 15000,
      maxBuffer: options.maxBuffer || 1024 * 1024,
      env: options.env || (process.env as Record<string, string>),
      shell: process.env.SHELL || (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash'),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as string;

    return { stdout: result.trim(), stderr: '', exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim() || e.message,
      exitCode: e.status ?? 1,
    };
  }
}

// ─── Process Pool ───────────────────────────────────────────────

interface ProcessEntry {
  id: string;
  child: ChildProcess;
  command: string;
  startedAt: number;
  label?: string;
}

const processPool = new Map<string, ProcessEntry>();

export function registerProcess(id: string, child: ChildProcess, command: string, label?: string): void {
  processPool.set(id, {
    id,
    child,
    command,
    startedAt: Date.now(),
    label,
  });

  child.on('close', () => {
    processPool.delete(id);
  });
}

export function killProcess(id: string): boolean {
  const entry = processPool.get(id);
  if (!entry) return false;
  try {
    entry.child.kill('SIGTERM');
    setTimeout(() => {
      try { entry.child.kill('SIGKILL'); } catch {}
    }, 2000);
    return true;
  } catch {
    return false;
  }
}

export function getRunningProcesses(): ProcessEntry[] {
  return Array.from(processPool.values());
}

export function killAllProcesses(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const [, entry] of processPool) {
    try {
      entry.child.kill(signal);
    } catch {}
  }
  processPool.clear();
}
