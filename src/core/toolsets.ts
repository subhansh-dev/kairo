/**
 * Toolsets — toolset management utilities.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Toolset {
  name: string;
  description: string;
  tools: string[];
  enabled: boolean;
}

const TOOLSETS_DIR = join(homedir(), '.kairo', 'toolsets');

/**
 * Load toolsets from disk.
 */
export function loadToolsets(): Toolset[] {
  if (!existsSync(TOOLSETS_DIR)) return [];

  try {
    const files = readdirSync(TOOLSETS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        return JSON.parse(readFileSync(join(TOOLSETS_DIR, f), 'utf-8')) as Toolset;
      } catch {
        return null;
      }
    }).filter(Boolean) as Toolset[];
  } catch {
    return [];
  }
}

/**
 * Get a toolset by name.
 */
export function getToolset(name: string): Toolset | undefined {
  return loadToolsets().find(t => t.name === name);
}

/**
 * Get enabled toolsets.
 */
export function getEnabledToolsets(): Toolset[] {
  return loadToolsets().filter(t => t.enabled);
}

/**
 * Get all tools from enabled toolsets.
 */
export function getToolsetTools(): string[] {
  const tools = new Set<string>();
  for (const toolset of getEnabledToolsets()) {
    for (const tool of toolset.tools) tools.add(tool);
  }
  return [...tools];
}

/**
 * Format toolsets for display.
 */
export function formatToolsets(): string {
  const toolsets = loadToolsets();
  if (toolsets.length === 0) return 'No toolsets configured.';
  return toolsets.map(t => {
    const icon = t.enabled ? '✅' : '⏸️';
    return `${icon} ${t.name}: ${t.description} (${t.tools.length} tools)`;
  }).join('\n');
}
