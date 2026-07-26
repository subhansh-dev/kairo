/**
 * Workspace and session configuration types.
 */

import type { CapabilityMode } from './capability';

export const DEFAULT_EVENT_BUFFER_CAPACITY = 64;

/**
 * Session-lifetime terminal backend paired with shutdown hook.
 */
export interface SessionTerminalBackend {
  backend: unknown;
  shutdown: () => void;
}

export interface EngineMemoryConfig {
  enabled?: boolean;
  maxEntries?: number;
}

/**
 * Per-session toolset/capability selection from session.bind metadata.
 */
export interface WorkspaceBindConfig {
  preset?: string;
  capabilityMode?: CapabilityMode;
  toolConfig?: Record<string, unknown>;
  viewerCtx?: Record<string, unknown>;
  yoloMode?: boolean;
  pinnedTools?: string[];
}

/**
 * Configuration for connecting to a hub server instance.
 */
export interface HubConfig {
  url: string;
  authToken?: string;
  serverId?: string;
  alphaTestKey?: string;
  allowInsecureWs?: boolean;
  readyFile?: string;
  diagServer?: boolean;
}

/**
 * Main workspace configuration.
 */
export interface WorkspaceConfig {
  workspaceId: string;
  cwd: string;
  sessionId?: string;
  hubConfig?: HubConfig;
  memory?: EngineMemoryConfig;
  bindConfig?: WorkspaceBindConfig;
  maxSessions?: number;
  eventBufferCapacity?: number;
  drainTimeoutMs?: number;
  terminationGraceMs?: number;
}

/**
 * Create a default workspace config.
 */
export function createWorkspaceConfig(
  workspaceId: string,
  cwd: string,
  overrides: Partial<WorkspaceConfig> = {}
): WorkspaceConfig {
  return {
    workspaceId,
    cwd,
    maxSessions: 8,
    eventBufferCapacity: DEFAULT_EVENT_BUFFER_CAPACITY,
    drainTimeoutMs: 30_000,
    terminationGraceMs: 45_000,
    ...overrides,
  };
}

/**
 * Validate workspace config.
 */
export function validateWorkspaceConfig(config: WorkspaceConfig): string[] {
  const errors: string[] = [];

  if (!config.workspaceId) {
    errors.push('workspaceId is required');
  }
  if (!config.cwd) {
    errors.push('cwd is required');
  }
  if (config.maxSessions !== undefined && config.maxSessions < 1) {
    errors.push('maxSessions must be >= 1');
  }
  if (config.drainTimeoutMs !== undefined && config.drainTimeoutMs < 1000) {
    errors.push('drainTimeoutMs must be >= 1000');
  }
  if (config.terminationGraceMs !== undefined && config.terminationGraceMs < 5000) {
    errors.push('terminationGraceMs must be >= 5000');
  }

  return errors;
}
