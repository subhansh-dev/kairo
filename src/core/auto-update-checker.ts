/**
 * Auto-update checker — check for updates on startup.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const UPDATE_CHECK_FILE = join(homedir(), '.kairo', 'last-update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateCheckState {
  lastCheckAt: number;
  latestVersion?: string;
  notified: boolean;
}

/**
 * Check if we should check for updates.
 */
export function shouldCheckForUpdates(): boolean {
  try {
    if (!existsSync(UPDATE_CHECK_FILE)) return true;
    const state: UpdateCheckState = JSON.parse(readFileSync(UPDATE_CHECK_FILE, 'utf-8'));
    return Date.now() - state.lastCheckAt > CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

/**
 * Record that we checked for updates.
 */
export function recordUpdateCheck(latestVersion?: string): void {
  try {
    const state: UpdateCheckState = {
      lastCheckAt: Date.now(),
      latestVersion,
      notified: false,
    };
    writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(state), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Get the last update check state.
 */
export function getLastUpdateCheck(): UpdateCheckState | null {
  try {
    if (!existsSync(UPDATE_CHECK_FILE)) return null;
    return JSON.parse(readFileSync(UPDATE_CHECK_FILE, 'utf-8'));
  } catch {
    return null;
  }
}
