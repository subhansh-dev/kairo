// ─── Event Names ───────────────────────────────────────────

export enum HookEventName {
  // Session lifecycle
  SessionStart = 'session_start',
  SessionEnd = 'session_end',
  Stop = 'stop',
  StopFailure = 'stop_failure',

  // Tool events
  PreToolUse = 'pre_tool_use',
  PostToolUse = 'post_tool_use',
  PostToolUseFailure = 'post_tool_use_failure',
  PermissionDenied = 'permission_denied',

  // User / notification events
  UserPromptSubmit = 'user_prompt_submit',
  Notification = 'notification',

  // Subagent events
  SubagentStart = 'subagent_start',
  SubagentStop = 'subagent_stop',

  // Compaction events
  PreCompact = 'pre_compact',
  PostCompact = 'post_compact',
}

// Parse from various formats (PascalCase, snake_case, camelCase)
export function parseHookEventName(s: string): HookEventName | null {
  const map: Record<string, HookEventName> = {
    // PascalCase
    'SessionStart': HookEventName.SessionStart,
    'PreToolUse': HookEventName.PreToolUse,
    'PostToolUse': HookEventName.PostToolUse,
    'PostToolUseFailure': HookEventName.PostToolUseFailure,
    'SessionEnd': HookEventName.SessionEnd,
    'Stop': HookEventName.Stop,
    'StopFailure': HookEventName.StopFailure,
    'Notification': HookEventName.Notification,
    'UserPromptSubmit': HookEventName.UserPromptSubmit,
    'PermissionDenied': HookEventName.PermissionDenied,
    'SubagentStart': HookEventName.SubagentStart,
    'SubagentStop': HookEventName.SubagentStop,
    'SubagentEnd': HookEventName.SubagentStop,
    'PreCompact': HookEventName.PreCompact,
    'PostCompact': HookEventName.PostCompact,
    // snake_case
    'session_start': HookEventName.SessionStart,
    'pre_tool_use': HookEventName.PreToolUse,
    'post_tool_use': HookEventName.PostToolUse,
    'post_tool_use_failure': HookEventName.PostToolUseFailure,
    'session_end': HookEventName.SessionEnd,
    'stop': HookEventName.Stop,
    'stop_failure': HookEventName.StopFailure,
    'notification': HookEventName.Notification,
    'user_prompt_submit': HookEventName.UserPromptSubmit,
    'permission_denied': HookEventName.PermissionDenied,
    'subagent_start': HookEventName.SubagentStart,
    'subagent_stop': HookEventName.SubagentStop,
    'subagent_end': HookEventName.SubagentStop,
    'pre_compact': HookEventName.PreCompact,
    'post_compact': HookEventName.PostCompact,
    // camelCase
    'sessionStart': HookEventName.SessionStart,
    'preToolUse': HookEventName.PreToolUse,
    'postToolUse': HookEventName.PostToolUse,
    'postToolUseFailure': HookEventName.PostToolUseFailure,
    'sessionEnd': HookEventName.SessionEnd,
    'stopFailure': HookEventName.StopFailure,
    'userPromptSubmit': HookEventName.UserPromptSubmit,
    'permissionDenied': HookEventName.PermissionDenied,
    'subagentStart': HookEventName.SubagentStart,
    'subagentStop': HookEventName.SubagentStop,
    'subagentEnd': HookEventName.SubagentStop,
    'preCompact': HookEventName.PreCompact,
    'postCompact': HookEventName.PostCompact,
    // Compat aliases
    'beforeShellExecution': HookEventName.PreToolUse,
    'beforeMCPExecution': HookEventName.PreToolUse,
    'beforeReadFile': HookEventName.PreToolUse,
    'afterShellExecution': HookEventName.PostToolUse,
    'afterMCPExecution': HookEventName.PostToolUse,
    'afterFileEdit': HookEventName.PostToolUse,
    'afterAgentResponse': HookEventName.PostToolUse,
    'afterAgentThought': HookEventName.PostToolUse,
    'beforeSubmitPrompt': HookEventName.UserPromptSubmit,
  };
  return map[s] ?? null;
}

/** Check if an event type uses blocking (deny/allow) semantics */
export function isBlockingEvent(event: HookEventName): boolean {
  return event === HookEventName.PreToolUse;
}

/** Check if an event is lifecycle (no matcher support) */
export function isLifecycleEvent(event: HookEventName): boolean {
  return event === HookEventName.SessionStart ||
         event === HookEventName.SessionEnd ||
         event === HookEventName.Stop ||
         event === HookEventName.UserPromptSubmit;
}

// ─── Payload Types ─────────────────────────────────────────

export const MAX_PAYLOAD_SIZE = 128 * 1024; // 128 KB

export type HookPayload =
  | { type: 'session_start'; source: string; modelId?: string; agentType?: string }
  | { type: 'session_end'; reason: string; turnCount?: number; toolCallCount?: number }
  | { type: 'stop'; reason: string }
  | { type: 'stop_failure'; error: string }
  | { type: 'pre_tool_use'; toolName: string; toolUseId: string; toolInput: any; toolInputTruncated: boolean; permissionMode?: string; subagentType?: string }
  | { type: 'post_tool_use'; toolName: string; toolUseId: string; toolInput: any; toolResult: any; toolInputTruncated: boolean; toolResultTruncated: boolean; durationMs?: number; isBackgrounded: boolean; subagentType?: string }
  | { type: 'post_tool_use_failure'; toolName: string; toolUseId: string; toolInput: any; toolInputTruncated: boolean; error: string; subagentType?: string }
  | { type: 'permission_denied'; toolName: string; toolUseId: string; toolInput: any; toolInputTruncated: boolean }
  | { type: 'user_prompt_submit'; prompt?: string }
  | { type: 'notification'; notificationType: string; message?: string; title?: string; level?: string }
  | { type: 'subagent_start'; subagentId: string; subagentType: string; description?: string }
  | { type: 'subagent_stop'; subagentId: string; subagentType: string; description?: string; exitCode?: number; durationMs?: number }
  | { type: 'pre_compact'; source: string }
  | { type: 'post_compact'; source: string };

// ─── Event Envelope ────────────────────────────────────────

export interface HookEventEnvelope {
  hookEventName: HookEventName;
  sessionId: string;
  cwd: string;
  workspaceRoot: string;
  timestamp: string;
  transcriptPath?: string;
  clientIdentifier?: string;
  promptId?: string;
  payload: HookPayload;
}

/**
 * Build a hook event envelope.
 */
export function buildEnvelope(
  event: HookEventName,
  sessionId: string,
  cwd: string,
  workspaceRoot: string,
  payload: HookPayload,
  opts?: { transcriptPath?: string; clientIdentifier?: string; promptId?: string },
): HookEventEnvelope {
  return {
    hookEventName: event,
    sessionId,
    cwd,
    workspaceRoot,
    timestamp: new Date().toISOString(),
    transcriptPath: opts?.transcriptPath,
    clientIdentifier: opts?.clientIdentifier,
    promptId: opts?.promptId,
    payload,
  };
}

/**
 * Extract the tool name from a payload (for matcher testing).
 */
export function extractToolName(payload: HookPayload): string | null {
  switch (payload.type) {
    case 'pre_tool_use':
    case 'post_tool_use':
    case 'post_tool_use_failure':
    case 'permission_denied':
      return payload.toolName;
    case 'notification':
      return payload.notificationType;
    default:
      return null;
  }
}

/**
 * Truncate a JSON value if serialized size exceeds MAX_PAYLOAD_SIZE.
 */
export function truncatePayload(value: any): { value: any; truncated: boolean } {
  const serialized = JSON.stringify(value) ?? '';
  if (serialized.length <= MAX_PAYLOAD_SIZE) {
    return { value, truncated: false };
  }
  const truncated = serialized.slice(0, MAX_PAYLOAD_SIZE) + ' [truncated]';
  return { value: truncated, truncated: true };
}
