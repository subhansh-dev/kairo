/**
 * Hooks — hook management utilities.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface HookConfig {
  event: string;
  command: string;
  description?: string;
  enabled: boolean;
}

const HOOKS_DIR = join(homedir(), '.kairo', 'hooks');

/**
 * Load hooks from the hooks directory.
 */
export function loadHooks(): HookConfig[] {
  if (!existsSync(HOOKS_DIR)) return [];

  try {
    const files = readdirSync(HOOKS_DIR).filter(f => f.endsWith('.json') || f.endsWith('.yaml'));
    return files.map(f => {
      try {
        const content = readFileSync(join(HOOKS_DIR, f), 'utf-8');
        return JSON.parse(content) as HookConfig;
      } catch {
        return null;
      }
    }).filter(Boolean) as HookConfig[];
  } catch {
    return [];
  }
}

/**
 * Get hooks for a specific event.
 */
export function getHooksForEvent(event: string): HookConfig[] {
  return loadHooks().filter(h => h.event === event && h.enabled);
}

/**
 * Format hooks for display.
 */
export function formatHooks(): string {
  const hooks = loadHooks();
  if (hooks.length === 0) return 'No hooks configured.';

  return hooks.map(h => {
    const icon = h.enabled ? '✅' : '⏸️';
    return `${icon} [${h.event}] ${h.command}${h.description ? ` — ${h.description}` : ''}`;
  }).join('\n');
}
