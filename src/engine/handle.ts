/**
 * Workspace handle — public API for interacting with a workspace instance.
 *
 * Manages session lifecycle, hub connection, tool dispatch,
 * and graceful shutdown.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { WorkspaceConfig, SessionTerminalBackend } from './config';
import type { SessionActivity, ActivityEntry } from './activity';
import type { CapabilityConfig } from './capability';
import { createActivityTracker, recordActivity } from './activity';
import { createRecoveryState, loadRecoveryState, saveRecoveryState, needsRecovery } from './recovery';

export interface WorkspaceSession {
  sessionId: string;
  cwd: string;
  activity: SessionActivity;
  capabilityConfig: CapabilityConfig;
  createdAt: number;
  lastActivity: number;
}

export interface WorkspaceHandle {
  config: WorkspaceConfig;
  sessions: Map<string, WorkspaceSession>;
  recovery: ReturnType<typeof createRecoveryState>;
  connected: boolean;
  drainStartTime?: number;
}

const DEFAULT_TERMINATION_GRACE_MS = 45_000;
const DEFAULT_DRAINING_FILE = '/tmp/workspace-server.draining';

/**
 * Create a new workspace handle.
 */
export async function createWorkspaceHandle(
  config: WorkspaceConfig
): Promise<WorkspaceHandle> {
  const recoveryPath = path.join(config.cwd, '.kairo', 'recovery.json');
  const recovery = await loadRecoveryState(recoveryPath);

  if (needsRecovery(recovery)) {
    console.log(`[kairo] Recovering ${recovery.pendingUploads.length} pending operations`);
  }

  return {
    config,
    sessions: new Map(),
    recovery,
    connected: false,
  };
}

/**
 * Bind a new session to the workspace.
 */
export function bindSession(
  handle: WorkspaceHandle,
  sessionId: string,
  cwd: string,
  capabilityConfig?: CapabilityConfig
): WorkspaceSession {
  if (handle.sessions.has(sessionId)) {
    throw new Error(`Session ${sessionId} already bound`);
  }

  if (handle.config.maxSessions && handle.sessions.size >= handle.config.maxSessions) {
    throw new Error(`Max sessions (${handle.config.maxSessions}) reached`);
  }

  const session: WorkspaceSession = {
    sessionId,
    cwd,
    activity: createActivityTracker(sessionId),
    capabilityConfig: capabilityConfig || { baseMode: 'full', overrides: [] },
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  handle.sessions.set(sessionId, session);

  recordActivity(session.activity, {
    type: 'session_start',
    metadata: { workspaceId: handle.config.workspaceId },
  });

  return session;
}

/**
 * Unbind a session from the workspace.
 */
export function unbindSession(
  handle: WorkspaceHandle,
  sessionId: string
): boolean {
  const session = handle.sessions.get(sessionId);
  if (!session) return false;

  recordActivity(session.activity, {
    type: 'session_end',
  });

  handle.sessions.delete(sessionId);
  return true;
}

/**
 * Get a session by ID.
 */
export function getSession(
  handle: WorkspaceHandle,
  sessionId: string
): WorkspaceSession | undefined {
  return handle.sessions.get(sessionId);
}

/**
 * Get all active sessions.
 */
export function getActiveSessions(handle: WorkspaceHandle): WorkspaceSession[] {
  return Array.from(handle.sessions.values());
}

/**
 * Prune idle sessions.
 */
export function pruneIdleSessions(
  handle: WorkspaceHandle,
  maxIdleMs: number = 30 * 60 * 1000 // 30 minutes
): string[] {
  const now = Date.now();
  const pruned: string[] = [];

  for (const [id, session] of handle.sessions) {
    if (now - session.lastActivity > maxIdleMs) {
      handle.sessions.delete(id);
      pruned.push(id);
    }
  }

  return pruned;
}

/**
 * Start graceful drain.
 */
export async function startDrain(
  handle: WorkspaceHandle,
  reason: string = 'shutdown'
): Promise<void> {
  handle.drainStartTime = Date.now();

  // Write draining marker file
  try {
    await fs.writeFile(DEFAULT_DRAINING_FILE, reason);
  } catch {
    // Non-fatal
  }

  // Wait for in-flight tool calls to complete
  const graceMs = handle.config.terminationGraceMs || DEFAULT_TERMINATION_GRACE_MS;
  const deadline = Date.now() + graceMs;

  while (Date.now() < deadline) {
    const hasActiveCalls = Array.from(handle.sessions.values()).some(
      s => s.activity.stats.totalToolCalls > 0
    );
    if (!hasActiveCalls) break;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Remove draining marker
  try {
    await fs.unlink(DEFAULT_DRAINING_FILE);
  } catch {
    // Non-fatal
  }
}

/**
 * Complete the drain and disconnect.
 */
export async function completeDrain(handle: WorkspaceHandle): Promise<void> {
  handle.connected = false;

  // Save recovery state
  const recoveryPath = path.join(handle.config.cwd, '.kairo', 'recovery.json');
  await saveRecoveryState(handle.recovery, recoveryPath);
}
