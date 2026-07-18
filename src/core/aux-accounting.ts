/**
 * Ambient session-accounting context for auxiliary LLM calls.
 *
 * Records token usage from auxiliary calls (vision, compression, title generation, etc.)
 * against the active session's accounting.
 */

export interface AuxUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  provider: string;
  task: string;
}

// Tasks whose usage is already accounted by the main loop
const EXCLUDED_TASKS = new Set(['moa_reference', 'moa_aggregator']);

// Current accounting context
let currentSessionId: string | null = null;
let usageRecorder: ((usage: AuxUsage) => void) | null = null;

/**
 * Set the accounting context for the current session.
 */
export function setAccountingContext(
  sessionId: string | null,
  recorder?: (usage: AuxUsage) => void,
): void {
  currentSessionId = sessionId;
  usageRecorder = recorder || null;
}

/**
 * Clear the accounting context.
 */
export function clearAccountingContext(): void {
  currentSessionId = null;
  usageRecorder = null;
}

/**
 * Get the current session ID for accounting.
 */
export function getAccountingSessionId(): string | null {
  return currentSessionId;
}

/**
 * Record auxiliary usage against the ambient session.
 */
export function recordAuxUsage(opts: {
  usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  task?: string;
  model?: string;
  provider?: string;
}): void {
  const { usage, task, model, provider } = opts;

  // Skip excluded tasks
  if (task && EXCLUDED_TASKS.has(task)) return;

  // Skip if no accounting context
  if (!currentSessionId || !usageRecorder) return;

  // Skip if no usage data
  if (!usage || (!usage.inputTokens && !usage.outputTokens)) return;

  usageRecorder({
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    cacheReadTokens: usage.cacheReadTokens || 0,
    cacheWriteTokens: usage.cacheWriteTokens || 0,
    model: model || 'unknown',
    provider: provider || 'unknown',
    task: task || 'auxiliary',
  });
}

/**
 * Build usage from a response object.
 */
export function extractUsageFromResponse(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} | null {
  if (!response || typeof response !== 'object') return null;
  const usage = (response as any).usage;
  if (!usage) return null;

  return {
    inputTokens: usage.inputTokens || usage.input_tokens || usage.promptTokens || usage.prompt_tokens || 0,
    outputTokens: usage.outputTokens || usage.output_tokens || usage.completionTokens || usage.completion_tokens || 0,
    cacheReadTokens: usage.cacheReadTokens || usage.cache_read_tokens || usage.cache_read_input_tokens || 0,
    cacheWriteTokens: usage.cacheWriteTokens || usage.cache_write_tokens || usage.cache_creation_input_tokens || 0,
  };
}
