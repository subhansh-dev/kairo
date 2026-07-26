/**
 * Monitor tool — watches a command's stdout and reports events.
 *
 * Each stdout line is an event; exit ends the watch.
 * Supports persistent mode and rate limiting.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const LINE_TRUNCATION_LIMIT = 500;
export const BATCH_TRUNCATION_LIMIT = 3_000;
export const BUFFER_CAP_BYTES = 1_048_576; // 1 MB
export const DEBOUNCE_MS = 200;
export const RATE_LIMIT_CAPACITY = 10;
export const RATE_LIMIT_REFILL_MS = 2_000;
export const AUTO_KILL_THRESHOLD_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 36_000_000; // 10 hours
export const MAX_TIMEOUT_MS = 36_000_000;
export const MAX_RESULT_SIZE_CHARS = 10_000;

export interface MonitorInput {
  command: string;
  description: string;
  timeout_ms?: number;
  persistent?: boolean;
}

export interface MonitorOutput {
  taskId: string;
  timeoutMs: number;
  persistent: boolean;
}

export interface MonitorEvent {
  timestamp: number;
  lines: string[];
  truncated: boolean;
}

/**
 * Active monitor instance.
 */
export class Monitor {
  private process: ChildProcess | null = null;
  private events: MonitorEvent[] = [];
  private buffer = '';
  private totalBytes = 0;
  private rateLimitTokens = RATE_LIMIT_CAPACITY;
  private lastRefill = Date.now();
  private autoKillStart = 0;
  private _output = '';

  constructor(
    public readonly taskId: string,
    public readonly description: string,
    public readonly persistent: boolean,
    public readonly timeoutMs: number,
  ) {}

  get output(): string {
    return this._output;
  }

  /**
   * Start monitoring a command.
   */
  start(command: string, cwd: string): void {
    this.process = spawn('bash', ['-c', command], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    this.process.on('close', () => {
      this.flushBuffer();
    });
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /**
   * Kill the monitored process.
   */
  kill(): void {
    if (this.process) {
      this.process.kill('SIGKILL');
      this.process = null;
    }
  }

  private handleOutput(data: string): void {
    this.buffer += data;
    this.totalBytes += data.length;

    if (this.totalBytes > BUFFER_CAP_BYTES) {
      this.kill();
      return;
    }

    // Rate limiting
    const now = Date.now();
    if (now - this.lastRefill >= RATE_LIMIT_REFILL_MS) {
      this.rateLimitTokens = RATE_LIMIT_CAPACITY;
      this.lastRefill = now;
    }

    if (this.rateLimitTokens <= 0) {
      if (this.autoKillStart === 0) {
        this.autoKillStart = now;
      } else if (now - this.autoKillStart > AUTO_KILL_THRESHOLD_MS) {
        this.kill();
        return;
      }
      return;
    }
    this.autoKillStart = 0;
    this.rateLimitTokens--;

    // Flush complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    if (lines.length > 0) {
      this.events.push({
        timestamp: now,
        lines: lines.map(l => l.slice(0, LINE_TRUNCATION_LIMIT)),
        truncated: false,
      });
    }
  }

  private flushBuffer(): void {
    if (this.buffer) {
      this.events.push({
        timestamp: Date.now(),
        lines: [this.buffer.slice(0, LINE_TRUNCATION_LIMIT)],
        truncated: this.buffer.length > LINE_TRUNCATION_LIMIT,
      });
      this.buffer = '';
    }
  }

  /**
   * Get all events as formatted string.
   */
  getEventsFormatted(): string {
    return this.events
      .flatMap(e => e.lines)
      .join('\n')
      .slice(0, MAX_RESULT_SIZE_CHARS);
  }
}

/**
 * Active monitors registry.
 */
const activeMonitors = new Map<string, Monitor>();

/**
 * Create a new monitor.
 */
export function createMonitor(input: MonitorInput, cwd: string): MonitorOutput {
  const taskId = `monitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const persistent = input.persistent ?? false;
  const timeoutMs = persistent ? 0 : (input.timeout_ms ?? DEFAULT_TIMEOUT_MS);

  const monitor = new Monitor(taskId, input.description, persistent, timeoutMs);
  monitor.start(input.command, cwd);
  activeMonitors.set(taskId, monitor);

  return { taskId, timeoutMs, persistent };
}

/**
 * Stop a monitor by task ID.
 */
export function stopMonitor(taskId: string): boolean {
  const monitor = activeMonitors.get(taskId);
  if (!monitor) return false;
  monitor.stop();
  activeMonitors.delete(taskId);
  return true;
}

/**
 * Kill a monitor by task ID.
 */
export function killMonitor(taskId: string): boolean {
  const monitor = activeMonitors.get(taskId);
  if (!monitor) return false;
  monitor.kill();
  activeMonitors.delete(taskId);
  return true;
}

/**
 * Get monitor output by task ID.
 */
export function getMonitorOutput(taskId: string): string | null {
  const monitor = activeMonitors.get(taskId);
  return monitor?.getEventsFormatted() ?? null;
}

/**
 * List all active monitors.
 */
export function listMonitors(): { taskId: string; description: string; persistent: boolean }[] {
  return Array.from(activeMonitors.values()).map(m => ({
    taskId: m.taskId,
    description: m.description,
    persistent: m.persistent,
  }));
}
