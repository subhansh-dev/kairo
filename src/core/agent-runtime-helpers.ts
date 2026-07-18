/**
 * Agent runtime helpers.
 *
 * Assorted helpers for the agent runtime: trajectory conversion,
 * message repair, think block stripping, reasoning extraction.
 */

/**
 * Strip thinking/reasoning blocks from stored content.
 * Removes <think>...</think>, <thinking>...</thinking>, etc.
 */
export function stripThinkBlocks(text: string): string {
  if (!text) return text;
  // Remove closed pairs
  let result = text.replace(/<(?:think|thinking|reasoning|thought)[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|thought)\s*>/gi, '');
  // Remove unclosed opens (at end of text)
  result = result.replace(/<(?:think|thinking|reasoning|thought)[^>]*>[\s\S]*$/gi, '');
  return result.trim();
}

/**
 * Repair corrupted JSON in tool call arguments.
 */
export function sanitizeToolCallArguments(args: string): string {
  if (!args) return '{}';
  try {
    // Try to parse as-is
    JSON.parse(args);
    return args;
  } catch {
    // Try to fix common issues
    let fixed = args.trim();
    // Remove trailing commas
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');
    // Try again
    try {
      JSON.parse(fixed);
      return fixed;
    } catch {
      return '{}';
    }
  }
}

/**
 * Enforce message alternation invariants.
 * Ensures the message sequence follows user/assistant alternation.
 */
export function repairMessageSequence(messages: Array<{ role: string; content?: unknown }>): Array<{ role: string; content?: unknown }> {
  if (messages.length === 0) return messages;

  const repaired: typeof messages = [];
  let lastRole: string | null = null;

  for (const msg of messages) {
    // Skip consecutive same-role messages (merge content)
    if (msg.role === lastRole && msg.role !== 'tool') {
      if (repaired.length > 0) {
        const prev = repaired[repaired.length - 1];
        const prevContent = typeof prev.content === 'string' ? prev.content : '';
        const msgContent = typeof msg.content === 'string' ? msg.content : '';
        prev.content = prevContent + '\n\n' + msgContent;
        continue;
      }
    }

    repaired.push(msg);
    if (msg.role !== 'tool') lastRole = msg.role;
  }

  return repaired;
}

/**
 * Extract reasoning from an API response.
 */
export function extractReasoning(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;

  const obj = response as Record<string, unknown>;

  // Check various reasoning fields
  const fields = ['reasoning', 'reasoning_content', 'thinking', 'thought'];
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === 'string' && value.trim()) return value;
  }

  // Check in choices
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    if (choice && typeof choice === 'object') {
      const message = (choice as any).message;
      if (message && typeof message === 'object') {
        for (const field of fields) {
          const value = message[field];
          if (typeof value === 'string' && value.trim()) return value;
        }
      }
    }
  }

  return null;
}

/**
 * Convert a message to trajectory format (text-only, no images).
 */
export function trajectoryNormalizeMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const result = { ...msg };

  // Strip multimodal content to text summary
  if (Array.isArray(result.content)) {
    const textParts = (result.content as any[])
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('\n');
    result.content = textParts || '[multimodal content]';
  }

  return result;
}

/**
 * Format a turn ID.
 */
export function formatTurnId(sessionId: string, turnNumber: number): string {
  return `${sessionId}:turn_${turnNumber}`;
}

/**
 * Note the start of a turn for concurrent-turn detection.
 */
export function noteTurnStart(agentId: string, turnId: string): void {
  // In a full implementation, this would track turn starts for debugging
  // concurrent turn issues. For now, it's a no-op.
}
