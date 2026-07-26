/**
 * Token estimation — rough token counting utilities.
 */

/**
 * Estimate tokens from character count (rough: 1 token ≈ 4 chars).
 */
export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Estimate tokens from text.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return estimateTokensFromChars(text.length);
}

/**
 * Estimate tokens from a message array.
 */
export function estimateMessageTokens(messages: Array<{ role: string; content: unknown }>): number {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    total += estimateTokens(content) + 4; // +4 for role/formatting overhead
  }
  return total;
}

/**
 * Estimate tokens from a JSON-serializable value.
 */
export function estimateJsonTokens(value: unknown): number {
  if (!value) return 0;
  return estimateTokens(JSON.stringify(value));
}

/**
 * Format token count for display.
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/**
 * Calculate context usage percentage.
 */
export function getContextUsagePercent(currentTokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return Math.round((currentTokens / maxTokens) * 100);
}

/**
 * Check if context is near the limit.
 */
export function isContextNearLimit(currentTokens: number, maxTokens: number, threshold = 80): boolean {
  return getContextUsagePercent(currentTokens, maxTokens) >= threshold;
}

/**
 * Get remaining tokens in context.
 */
export function getRemainingTokens(currentTokens: number, maxTokens: number): number {
  return Math.max(0, maxTokens - currentTokens);
}
