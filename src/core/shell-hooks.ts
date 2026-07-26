/**
 * Kairo — Shell Hooks
 * Shell-script hooks bridge.
 * Ported from Hermes Agent's shell_hooks.py
 *
 * Reads hook configs and registers callbacks on the hook manager
 * so shell scripts can intercept tool calls.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ──────────────────────────────────────────────────────

export interface ShellHook {
  event: 'pre_tool' | 'post_tool' | 'pre_response' | 'post_response';
  command: string;
  description?: string;
  enabled: boolean;
}

export interface ShellHookConfig {
  hooks: ShellHook[];
  autoAccept: boolean;
}

// ─── Hook Registry ──────────────────────────────────────────────

let hooks: ShellHook[] = [];
let autoAccept = false;

export function loadShellHooks(configPath?: string): void {
  const paths = [
    configPath,
    join(homedir(), '.kairo', 'hooks.json'),
    join(process.cwd(), '.kairo', 'hooks.json'),
  ].filter(Boolean) as string[];

  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const config = JSON.parse(readFileSync(path, 'utf-8'));
        hooks = (config.hooks || []).filter((h: ShellHook) => h.enabled !== false);
        autoAccept = config.autoAccept || false;
        return;
      } catch {}
    }
  }
}

/**
 * Run shell hooks for an event.
 */
export function runShellHooks(
  event: ShellHook['event'],
  context: { toolName?: string; args?: string; result?: string },
): { allowed: boolean; output?: string } {
  const matching = hooks.filter(h => h.event === event);
  if (matching.length === 0) return { allowed: true };

  for (const hook of matching) {
    try {
      const env = {
        KAIRO_EVENT: event,
        KAIRO_TOOL: context.toolName || '',
        KAIRO_ARGS: context.args || '',
        KAIRO_RESULT: context.result || '',
      };

      const output = execSync(hook.command, {
        encoding: 'utf-8',
        env: { ...process.env, ...env },
        timeout: 10000,
        stdio: 'pipe',
      }).trim();

      // Check if hook blocked the action
      if (output.toLowerCase().includes('block') || output.toLowerCase().includes('deny')) {
        return { allowed: false, output };
      }
    } catch (e: any) {
      // Hook error — don't block, just log
      console.error(`Shell hook error (${hook.command}): ${e.message}`);
    }
  }

  return { allowed: true };
}

/**
 * Get loaded hooks for display.
 */
export function getLoadedHooks(): ShellHook[] {
  return [...hooks];
}
