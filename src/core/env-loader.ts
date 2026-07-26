/**
 * Env loader — load environment variables from files.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Load environment variables from a .env file.
 */
export function loadEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;

  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Load .env file and set environment variables.
 */
export function applyEnvFile(path: string): number {
  const env = loadEnvFile(path);
  let count = 0;
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) {
      process.env[key] = value;
      count++;
    }
  }
  return count;
}

/**
 * Load the default .env file from ~/.kairo/.env
 */
export function loadDefaultEnv(): number {
  const defaultPath = join(homedir(), '.kairo', '.env');
  return applyEnvFile(defaultPath);
}

/**
 * Get an environment variable with fallback.
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

/**
 * Check if an environment variable is set.
 */
export function hasEnv(key: string): boolean {
  return key in process.env && !!process.env[key];
}
