/**
 * Permission state persistence — load/save per-cwd permission state.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { EditPolicy, PermissionState } from '../permission.js';
import { defaultPermissionState } from '../permission.js';

// ─── State File Paths ──────────────────────────────────────

function stateDirForCwd(cwd: string): string {
  return path.join(os.homedir(), '.kairo', 'sessions', Buffer.from(cwd).toString('base64url'));
}

function sanitizeClientId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function stateFilePath(dir: string, clientIdentifier?: string): string {
  const filename = clientIdentifier
    ? `permission_${sanitizeClientId(clientIdentifier)}.json`
    : 'permission.json';
  return path.join(dir, filename);
}

// ─── Load State ────────────────────────────────────────────

export async function loadStateFromDisk(
  cwd: string,
  clientIdentifier?: string,
): Promise<PermissionState> {
  const dir = stateDirForCwd(cwd);
  return loadStateFromDir(dir, clientIdentifier);
}

async function loadStateFromDir(
  dir: string,
  clientIdentifier?: string,
): Promise<PermissionState> {
  if (clientIdentifier) {
    const perClient = stateFilePath(dir, clientIdentifier);
    const state = tryLoadState(perClient);
    if (state) return state;

    const shared = stateFilePath(dir);
    return tryLoadState(shared) ?? defaultPermissionState();
  }

  const path_ = stateFilePath(dir);
  return tryLoadState(path_) ?? defaultPermissionState();
}

function tryLoadState(filePath: string): PermissionState | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as PermissionState;
  } catch {
    return null;
  }
}

// ─── Persist State ─────────────────────────────────────────

export async function persistState(
  cwd: string,
  state: PermissionState,
  clientIdentifier?: string,
): Promise<void> {
  const dir = stateDirForCwd(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = stateFilePath(dir, clientIdentifier);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Cleanup ───────────────────────────────────────────────

export async function cleanupStalePermissionState(maxAgeMs: number): Promise<void> {
  const sessionsDir = path.join(os.homedir(), '.kairo', 'sessions');
  if (!fs.existsSync(sessionsDir)) return;

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = path.join(sessionsDir, entry.name);
    const files = fs.readdirSync(sessionDir);
    for (const file of files) {
      if (!file.startsWith('permission') || !file.endsWith('.json')) continue;
      const filePath = path.join(sessionDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (Date.now() - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Skip
      }
    }
  }
}
