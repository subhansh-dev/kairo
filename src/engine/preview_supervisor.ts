/**
 * Preview proxy supervisor — manages preview proxy process lifecycle.
 *
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export const PREVIEW_PROXY_BIN_PATH = '/usr/local/bin/xai-grok-preview-proxy';
export const PREVIEW_PROXY_LOG_PATH = '/var/tmp/workspace-server/tmp/preview-proxy.log';
export const PREVIEW_PROXY_HEALTHY_RUN_SECS = 30;
export const PREVIEW_PROXY_RESTART_BACKOFF_BASE_SECS = 1;
export const PREVIEW_PROXY_RESTART_BACKOFF_CAP_SECS = 30;

export enum PreviewVisibility {
  Owner = 'owner',
  Public = 'public',
}

export interface PreviewSupervisorOptions {
  visibility?: PreviewVisibility;
  port?: number;
  activityTracker?: { isActive: () => boolean };
  onRestart?: (reason: string) => void;
}

export class PreviewSupervisor {
  private child: ChildProcess | null = null;
  private restartCount = 0;
  private lastStartTime = 0;
  private options: PreviewSupervisorOptions;
  private stopping = false;

  constructor(options: PreviewSupervisorOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    const backoff = this.calculateBackoff();
    if (backoff > 0) {
      await sleep(backoff * 1000);
    }

    if (this.stopping) return;

    const args: string[] = [];
    if (this.options.visibility) {
      args.push('--visibility', this.options.visibility);
    }
    if (this.options.port) {
      args.push('--port', String(this.options.port));
    }

    try {
      this.child = spawn(PREVIEW_PROXY_BIN_PATH, args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.lastStartTime = Date.now();
      this.restartCount++;

      // Log output to file
      if (this.child.stdout) {
        this.logToFile(this.child.stdout);
      }
      if (this.child.stderr) {
        this.logToFile(this.child.stderr);
      }

      this.child.on('exit', (code, signal) => {
        if (this.stopping) return;

        const runDuration = (Date.now() - this.lastStartTime) / 1000;
        const wasHealthy = runDuration >= PREVIEW_PROXY_HEALTHY_RUN_SECS;

        if (wasHealthy) {
          this.restartCount = 0; // Reset on healthy run
        }

        this.options.onRestart?.(
          signal ? `signal ${signal}` : `exit code ${code}`
        );

        // Auto-restart
        this.start().catch(() => {});
      });

      this.child.on('error', (err) => {
        if (this.stopping) return;
        console.error('[PreviewSupervisor] Spawn error:', err.message);
        this.options.onRestart?.('spawn_error');
        this.start().catch(() => {});
      });
    } catch (err) {
      console.error('[PreviewSupervisor] Failed to start:', err);
      this.options.onRestart?.('spawn_error');
      // Retry with backoff
      this.start().catch(() => {});
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.child) {
      this.child.kill('SIGTERM');
      // Give it a moment to exit gracefully
      await new Promise<void>((resolve) => {
        if (!this.child) { resolve(); return; }
        const timeout = setTimeout(() => {
          this.child?.kill('SIGKILL');
          resolve();
        }, 5000);
        this.child.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.child = null;
    }
  }

  private calculateBackoff(): number {
    if (this.restartCount === 0) return 0;
    const backoff = Math.min(
      PREVIEW_PROXY_RESTART_BACKOFF_BASE_SECS * Math.pow(2, this.restartCount - 1),
      PREVIEW_PROXY_RESTART_BACKOFF_CAP_SECS
    );
    return backoff;
  }

  private async logToFile(stream: NodeJS.ReadableStream): Promise<void> {
    try {
      await fs.mkdir(path.dirname(PREVIEW_PROXY_LOG_PATH), { recursive: true });
      const fd = await fs.open(PREVIEW_PROXY_LOG_PATH, 'a');
      stream.pipe(fd.createWriteStream());
    } catch {
      // Silently ignore log file errors
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
