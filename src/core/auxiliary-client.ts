/**
 * Shared auxiliary client router for side tasks.
 *
 * Provides a single resolution chain so every consumer (compression, search,
 * vision, etc.) picks up the best available backend without duplicating fallback logic.
 */

export interface AuxiliaryOptions {
  task: string;         // 'title_generation' | 'compression' | 'vision' | 'web_extract' | etc.
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  provider?: string;
  signal?: AbortSignal;
}

export interface AuxiliaryResult {
  content: string;
  model: string;
  provider: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Build a simple auxiliary request (single prompt, no conversation).
 */
export function buildAuxiliaryPrompt(
  systemPrompt: string,
  userContent: string,
): Array<{ role: string; content: string }> {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

/**
 * Truncate text to a limit for auxiliary calls.
 */
export function truncateForAuxiliary(text: string, limit = 8000): string {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit).trimEnd() + '\n…(truncated)';
}

/**
 * Get the auxiliary task type from a task name.
 */
export function getAuxiliaryTaskType(task: string): string {
  const taskMap: Record<string, string> = {
    title_generation: 'quick',
    compression: 'quick',
    vision: 'general',
    web_extract: 'quick',
    session_search: 'quick',
    summary: 'quick',
    commit_message: 'quick',
    explain_error: 'quick',
  };
  return taskMap[task] || 'quick';
}

/**
 * Build auxiliary options with defaults.
 */
export function buildAuxiliaryOptions(
  task: string,
  messages: Array<{ role: string; content: string }>,
  overrides: Partial<AuxiliaryOptions> = {},
): AuxiliaryOptions {
  return {
    task,
    messages,
    maxTokens: overrides.maxTokens || 1000,
    temperature: overrides.temperature ?? 0.3,
    model: overrides.model,
    provider: overrides.provider,
    signal: overrides.signal,
  };
}

/**
 * Format an auxiliary result for display.
 */
export function formatAuxiliaryResult(result: AuxiliaryResult, maxLen = 200): string {
  if (!result.content) return '(no result)';
  if (result.content.length <= maxLen) return result.content;
  return result.content.slice(0, maxLen).trimEnd() + '…';
}
