/**
 * Kairo — Tool Result Size Limits
 * Prevents oversized tool results from consuming too much context.
 * When a result exceeds the limit, it's truncated with a note.
 */

/** Default max size in characters for tool results */
export const MAX_TOOL_RESULT_CHARS = 50_000;

/** Max size for tool results in a single turn (batch of parallel calls) */
export const MAX_TURN_RESULT_CHARS = 150_000;

/** Truncation notice appended to oversized results */
const TRUNCATION_NOTICE = '\n\n[... result truncated — exceeded {limit} character limit. Original size: {original} chars. Use offset/limit parameters to read specific sections.]';

/**
 * Truncate a tool result if it exceeds the size limit.
 * Returns the original if within limits, or a truncated version with a notice.
 */
export function truncateToolResult(output: string, limit: number = MAX_TOOL_RESULT_CHARS): string {
  if (output.length <= limit) return output;

  // Keep the first 80% and last 20% of the limit
  const keepStart = Math.floor(limit * 0.8);
  const keepEnd = limit - keepStart;

  const truncated = output.slice(0, keepStart)
    + '\n\n[... middle section truncated ...]\n\n'
    + output.slice(-keepEnd);

  return truncated + TRUNCATION_NOTICE
    .replace('{limit}', limit.toString())
    .replace('{original}', output.length.toString());
}

/**
 * Check if a batch of tool results exceeds the per-turn limit.
 * If so, truncate the largest results until under budget.
 */
export function enforceToolBudget(results: Array<{ output: string }>, budget: number = MAX_TURN_RESULT_CHARS): void {
  let total = results.reduce((sum, r) => sum + r.output.length, 0);
  if (total <= budget) return;

  // Sort by size descending, truncate largest first
  const sorted = results
    .map((r, i) => ({ ...r, index: i }))
    .sort((a, b) => b.output.length - a.output.length);

  for (const entry of sorted) {
    if (total <= budget) break;
    const excess = total - budget;
    const newLen = Math.max(1000, entry.output.length - excess);
    results[entry.index].output = truncateToolResult(entry.output, newLen);
    total = results.reduce((sum, r) => sum + r.output.length, 0);
  }
}
