/**
 * Tool dispatch — tool call dispatch and routing.
 */

export interface ToolDispatchResult {
  toolName: string;
  args: Record<string, unknown>;
  allowed: boolean;
  reason?: string;
  parallel: boolean;
}

/**
 * Dispatch a tool call through safety checks.
 */
export function dispatchToolCall(toolName: string, args: Record<string, unknown>): ToolDispatchResult {
  // Read-only tools are always allowed
  const readOnlyTools = ['read', 'grep', 'glob', 'ls', 'web_fetch', 'web_search'];
  if (readOnlyTools.includes(toolName)) {
    return { toolName, args, allowed: true, parallel: true };
  }

  // Write tools require safety checks
  const writeTools = ['write', 'edit'];
  if (writeTools.includes(toolName)) {
    return { toolName, args, allowed: true, parallel: false };
  }

  // Exec tools require more careful handling
  if (toolName === 'exec') {
    return { toolName, args, allowed: true, parallel: false };
  }

  // Default: allow but serialize
  return { toolName, args, allowed: true, parallel: false };
}

/**
 * Check if a batch of tool calls can be parallelized.
 */
export function canParallelizeBatch(calls: Array<{ name: string; args: Record<string, unknown> }>): boolean {
  // All must be read-only
  const readOnlyTools = ['read', 'grep', 'glob', 'ls', 'web_fetch', 'web_search'];
  return calls.every(c => readOnlyTools.includes(c.name));
}

/**
 * Group tool calls into parallel and serial batches.
 */
export function groupToolCalls(calls: Array<{ name: string; args: Record<string, unknown> }>): {
  parallel: typeof calls;
  serial: typeof calls;
} {
  const readOnlyTools = ['read', 'grep', 'glob', 'ls', 'web_fetch', 'web_search'];
  const parallel: typeof calls = [];
  const serial: typeof calls = [];

  for (const call of calls) {
    if (readOnlyTools.includes(call.name)) {
      parallel.push(call);
    } else {
      serial.push(call);
    }
  }

  return { parallel, serial };
}
