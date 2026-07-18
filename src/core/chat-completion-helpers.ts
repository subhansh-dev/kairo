/**
 * Chat completion helpers.
 *
 * Helper functions for the chat-completions code path: request building,
 * fallback activation, max-iterations handling, resource cleanup.
 */

/**
 * Estimate context tokens from an API payload.
 * Rough: 1 token ≈ 4 chars.
 */
export function estimateRequestContextTokens(messages: Array<{ role: string; content?: unknown }>): number {
  let totalChars = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    totalChars += content.length + 4; // +4 for role overhead
  }
  return Math.ceil(totalChars / 4);
}

/**
 * Build a system message for the request.
 */
export function buildSystemMessage(
  systemPrompt: string,
  contextPrefix?: string,
  roleInstruction?: string,
): string {
  const parts = [systemPrompt];
  if (contextPrefix) parts.push(contextPrefix);
  if (roleInstruction) parts.push(`## Current Role\n${roleInstruction}`);
  return parts.join('\n\n');
}

/**
 * Materialize an assistant message from streaming content.
 */
export function materializeAssistantMessage(
  content: string,
  toolCalls?: Array<{ id: string; name: string; arguments: string }>,
): { role: string; content: string; tool_calls?: unknown[] } {
  const msg: any = { role: 'assistant', content };
  if (toolCalls && toolCalls.length > 0) {
    msg.tool_calls = toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  return msg;
}

/**
 * Handle max iterations reached.
 * Asks the model for a summary with tools stripped.
 */
export function buildMaxIterationsMessage(
  iterations: number,
  maxIterations: number,
): string {
  return [
    `[System: Iteration budget exhausted (${iterations}/${maxIterations}).`,
    'You have reached the maximum number of tool-calling iterations for this turn.',
    'Please provide a final summary of what you have accomplished and what remains.',
    'Do not attempt any more tool calls.]',
  ].join('\n');
}

/**
 * Check if a response indicates the model wants to stop.
 */
export function isStopResponse(content: string): boolean {
  if (!content) return true;
  const lower = content.trim().toLowerCase();
  if (lower === '' || lower === '(empty)') return true;
  // Check for common stop patterns
  if (lower === 'done' || lower === 'done.' || lower === 'finished') return true;
  return false;
}

/**
 * Format a duration for display.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m${sec}s`;
}

/**
 * Format token count for display.
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/**
 * Build a diagnostic summary of the turn.
 */
export function buildTurnDiagnostic(opts: {
  model: string;
  provider: string;
  apiCalls: number;
  maxIterations: number;
  toolCalls: number;
  responseLength: number;
  durationMs: number;
  exitReason: string;
}): string {
  return [
    `Turn ended: reason=${opts.exitReason}`,
    `model=${opts.provider}/${opts.model}`,
    `api_calls=${opts.apiCalls}/${opts.maxIterations}`,
    `tool_turns=${opts.toolCalls}`,
    `response_len=${opts.responseLength}`,
    `duration=${formatDuration(opts.durationMs)}`,
  ].join(' ');
}
