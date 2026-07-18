/**
 * Config — configuration management utilities.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const CONFIG_DIR = join(homedir(), '.kairo');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');

/**
 * Load configuration from disk.
 */
export function loadConfig(): Record<string, unknown> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      return parseYaml(content) || {};
    }
  } catch { /* ok */ }
  return {};
}

/**
 * Save configuration to disk.
 */
export function saveConfig(config: Record<string, unknown>): void {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, stringifyYaml(config), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Get a config value by key path (e.g., 'auxiliary.compression.model').
 */
export function getConfigValue(keyPath: string, defaultValue?: unknown): unknown {
  const config = loadConfig();
  const keys = keyPath.split('.');
  let current: any = config;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return defaultValue;
    }
    current = current[key];
  }

  return current !== undefined ? current : defaultValue;
}

/**
 * Set a config value by key path.
 */
export function setConfigValue(keyPath: string, value: unknown): void {
  const config = loadConfig();
  const keys = keyPath.split('.');
  let current: any = config;

  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }

  current[keys[keys.length - 1]] = value;
  saveConfig(config);
}

/**
 * Check if a config key exists.
 */
export function hasConfig(keyPath: string): boolean {
  return getConfigValue(keyPath) !== undefined;
}

/**
 * Get the config directory path.
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Get the config file path.
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
