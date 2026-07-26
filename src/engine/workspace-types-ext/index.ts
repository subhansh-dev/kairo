/**
 * Workspace types extended — deeper workspace type definitions.
 * Ported from the Rust workspace-types crate.
 */

// ─── Tool Types ────────────────────────────────────────────

export type ToolTier = 'read' | 'write' | 'exec';

export interface WorkspaceTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  tier: ToolTier;
  concurrencySafe: boolean;
}

// ─── Skill Types ───────────────────────────────────────────

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  enabled: boolean;
}

// ─── Session Types ─────────────────────────────────────────

export interface WorkspaceSession {
  id: string;
  agentId: string;
  mode: string;
  model: string;
  createdAt: Date;
  lastActive: Date;
  messageCount: number;
  tokenCount: number;
}

// ─── Search Types ──────────────────────────────────────────

export interface WorkspaceSearchQuery {
  query: string;
  filePattern?: string;
  maxResults?: number;
  includeContent?: boolean;
}

export interface WorkspaceSearchResult {
  filePath: string;
  line: number;
  column: number;
  match: string;
  context?: string;
}

// ─── Plugin Types ──────────────────────────────────────────

export interface WorkspacePlugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// ─── Permission Types ──────────────────────────────────────

export type PermissionAction = 'allow' | 'deny' | 'ask';

export interface WorkspacePermissionRule {
  toolPattern: string;
  action: PermissionAction;
  conditions?: Record<string, unknown>;
}

// ─── Memory Types ──────────────────────────────────────────

export interface WorkspaceMemoryEntry {
  id: string;
  content: string;
  category: string;
  tags: string[];
  createdAt: Date;
  relevance: number;
}

// ─── Hunk Types ────────────────────────────────────────────

export interface WorkspaceHunk {
  id: string;
  filePath: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  oldText: string | null;
  newText: string;
  selected: boolean;
}

// ─── Git Types ─────────────────────────────────────────────

export interface WorkspaceGitStatus {
  isRepo: boolean;
  branch?: string;
  dirty: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

// ─── File Types ────────────────────────────────────────────

export interface WorkspaceFileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
}

// ─── Config Types ──────────────────────────────────────────

export interface WorkspaceConfigEntry {
  key: string;
  value: unknown;
  source: 'user' | 'project' | 'env';
}

// ─── RPC Types ─────────────────────────────────────────────

export interface RpcEnvelope {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type RpcMessage = RpcEnvelope;

export function createRpcRequest(id: string | number, method: string, params?: Record<string, unknown>): RpcEnvelope {
  return { jsonrpc: '2.0', id, method, params };
}

export function createRpcResponse(id: string | number, result?: unknown, error?: { code: number; message: string }): RpcEnvelope {
  return { jsonrpc: '2.0', id, result, error };
}

export function createRpcNotification(method: string, params?: Record<string, unknown>): RpcEnvelope {
  return { jsonrpc: '2.0', method, params };
}

// ─── Event Types ───────────────────────────────────────────

export type WorkspaceEventType =
  | 'file_changed'
  | 'file_created'
  | 'file_deleted'
  | 'session_started'
  | 'session_ended'
  | 'tool_called'
  | 'config_updated'
  | 'permission_requested';

export interface WorkspaceEvent {
  type: WorkspaceEventType;
  timestamp: Date;
  data: Record<string, unknown>;
}

// ─── Error Types ───────────────────────────────────────────

export class WorkspaceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'WorkspaceError';
  }
}

export const WORKSPACE_ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_CONFIG: 'INVALID_CONFIG',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  HUNK_CONFLICT: 'HUNK_CONFLICT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  GIT_ERROR: 'GIT_ERROR',
} as const;
