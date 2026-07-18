/**
 * Tool taxonomy — harness-independent tool vocabulary and identity.
 * Ported from the Rust tool_taxonomy crate.
 */

// ─── Tool Kinds ────────────────────────────────────────────

export type ToolKind =
  | 'read' | 'edit' | 'delete' | 'write' | 'move'
  | 'list_dir' | 'list' | 'search' | 'lsp'
  | 'execute' | 'plan' | 'web_search' | 'web_fetch'
  | 'background_task_action' | 'wait_tasks_action' | 'kill_task_action'
  | 'skill' | 'memory_search' | 'memory_get'
  | 'task' | 'enter_plan' | 'exit_plan' | 'ask_user'
  | 'image_gen' | 'video_gen' | 'image_to_video' | 'reference_to_video'
  | 'deploy_app' | 'search_tool' | 'use_tool'
  | 'monitor' | 'goal_update' | 'other';

export type ToolNamespace = 'kairo' | 'mcp' | 'builtin' | 'opencode';

// ─── Presentation Names ────────────────────────────────────

const PRESENTATION_NAMES: Record<ToolKind, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  write: 'Write',
  move: 'Move',
  list_dir: 'List Files',
  list: 'List Files',
  search: 'Search',
  lsp: 'Code Intelligence',
  execute: 'Run Command',
  plan: 'Plan',
  web_search: 'Web Search',
  web_fetch: 'Web Fetch',
  background_task_action: 'Background Task',
  wait_tasks_action: 'Wait for Tasks',
  kill_task_action: 'Kill Task',
  skill: 'Skill',
  memory_search: 'Memory Search',
  memory_get: 'Memory Read',
  task: 'Subagent',
  enter_plan: 'Enter Plan Mode',
  exit_plan: 'Exit Plan Mode',
  ask_user: 'Ask User',
  image_gen: 'Generate Image',
  video_gen: 'Generate Video',
  image_to_video: 'Generate Video',
  reference_to_video: 'Generate Video',
  deploy_app: 'Deploy App',
  search_tool: 'Search Tools',
  use_tool: 'Use Tool',
  monitor: 'Monitor',
  goal_update: 'Update Goal',
  other: 'Tool',
};

// ─── Read-Only Classification ──────────────────────────────

const READ_ONLY_KINDS = new Set<ToolKind>([
  'read', 'search', 'lsp', 'list_dir', 'list',
  'memory_search', 'memory_get', 'web_search', 'web_fetch',
  'enter_plan', 'exit_plan', 'ask_user',
]);

// ─── Canonical Input Fields ────────────────────────────────

export const CANONICAL_FIELDS = {
  PATH: 'path',
  OFFSET: 'offset',
  LIMIT: 'limit',
  COMMAND: 'command',
  DESCRIPTION: 'description',
  CWD: 'cwd',
  DIRECTORY: 'directory',
  PATTERN: 'pattern',
} as const;

// ─── Tool Meta ─────────────────────────────────────────────

export const TOOL_META_KEY = 'x.ai/tool';
export const TOOL_META_VERSION = 1;

export interface ToolIdentity {
  toolKind: ToolKind;
  namespace: ToolNamespace;
  presentationName: string;
  readOnly: boolean;
}

export interface CanonicalToolMeta {
  version: number;
  name: string;
  kind: ToolKind;
  namespace: ToolNamespace;
  label: string;
  readOnly: boolean;
  input?: Record<string, unknown>;
}

/**
 * Get the presentation name for a tool kind.
 */
export function getPresentationName(kind: ToolKind): string {
  return PRESENTATION_NAMES[kind] ?? 'Tool';
}

/**
 * Check if a tool kind is read-only by default.
 */
export function isReadOnly(kind: ToolKind): boolean {
  return READ_ONLY_KINDS.has(kind);
}

/**
 * Create a tool identity.
 */
export function createToolIdentity(kind: ToolKind, namespace: ToolNamespace = 'kairo'): ToolIdentity {
  return {
    toolKind: kind,
    namespace,
    presentationName: getPresentationName(kind),
    readOnly: isReadOnly(kind),
  };
}

/**
 * Create canonical tool meta.
 */
export function createCanonicalToolMeta(
  name: string,
  identity: ToolIdentity,
  input?: Record<string, unknown>,
): CanonicalToolMeta {
  return {
    version: TOOL_META_VERSION,
    name,
    kind: identity.toolKind,
    namespace: identity.namespace,
    label: identity.presentationName,
    readOnly: identity.readOnly,
    input,
  };
}

/**
 * Merge tool meta into an existing _meta object.
 */
export function mergeToolMeta(
  meta: CanonicalToolMeta,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing };
  result[TOOL_META_KEY] = meta;
  return result;
}
