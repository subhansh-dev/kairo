/**
 * Shared helpers for classifying tool result payloads.
 */

export const FILE_MUTATING_TOOL_NAMES = new Set(['write', 'edit']);

export const NO_EFFECT_TOOL_NAMES = new Set([
  'read', 'grep', 'glob', 'ls', 'session_search', 'web_fetch', 'web_search',
]);

/**
 * Check if a tool may have side effects (mutates state).
 */
export function toolMayHaveSideEffect(toolName: string): boolean {
  return !NO_EFFECT_TOOL_NAMES.has(toolName);
}

/**
 * Check if a file mutation result proves the write landed successfully.
 */
export function fileMutationResultLanded(toolName: string, result: unknown): boolean {
  if (!FILE_MUTATING_TOOL_NAMES.has(toolName) || typeof result !== 'string') return false;
  try {
    const data = JSON.parse(result.trim());
    if (typeof data !== 'object' || data === null || data.error) return false;
    if (toolName === 'write') return 'bytesWritten' in data || 'success' in data;
    if (toolName === 'edit') return data.success === true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a tool result indicates success.
 */
export function isToolResultSuccess(result: unknown): boolean {
  if (typeof result === 'string') {
    try {
      const data = JSON.parse(result);
      return !data.error;
    } catch {
      return true; // plain string = success
    }
  }
  if (typeof result === 'object' && result !== null) {
    return !(result as any).error;
  }
  return true;
}
