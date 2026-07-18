/**
 * Tools config — tools configuration management.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ToolConfig {
  name: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
}

const TOOLS_CONFIG_FILE = join(homedir(), '.kairo', 'tools-config.json');

/**
 * Load tools configuration.
 */
export function loadToolsConfig(): Record<string, ToolConfig> {
  try {
    if (existsSync(TOOLS_CONFIG_FILE)) {
      return JSON.parse(readFileSync(TOOLS_CONFIG_FILE, 'utf-8'));
    }
  } catch { /* ok */ }
  return {};
}

/**
 * Save tools configuration.
 */
export function saveToolsConfig(config: Record<string, ToolConfig>): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(TOOLS_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Enable/disable a tool.
 */
export function toggleTool(name: string, enabled: boolean): void {
  const config = loadToolsConfig();
  if (!config[name]) {
    config[name] = { name, enabled };
  } else {
    config[name].enabled = enabled;
  }
  saveToolsConfig(config);
}

/**
 * Get tool config.
 */
export function getToolConfig(name: string): ToolConfig | undefined {
  return loadToolsConfig()[name];
}

/**
 * Check if a tool is enabled.
 */
export function isToolEnabled(name: string): boolean {
  const config = getToolConfig(name);
  return config ? config.enabled : true; // Enabled by default
}

/**
 * Format tools config for display.
 */
export function formatToolsConfig(config: Record<string, ToolConfig>): string {
  return Object.values(config).map(t => {
    const icon = t.enabled ? '✅' : '⏸️';
    return `${icon} ${t.name}`;
  }).join('\n');
}
