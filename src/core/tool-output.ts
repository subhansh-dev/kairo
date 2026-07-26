/**
 * Tool output — tool output formatting and management.
 */

/**
 * Truncate tool output to a maximum length.
 */
export function truncateOutput(output: string, maxLen = 10000): string {
  if (!output || output.length <= maxLen) return output;
  return output.slice(0, maxLen) + '\n… [truncated]';
}

/**
 * Compact tool output by removing excessive whitespace.
 */
export function compactOutput(output: string): string {
  if (!output) return output;
  return output.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Summarize tool output for display.
 */
export function summarizeOutput(output: string, maxLen = 200): string {
  if (!output) return '(empty)';
  const compact = compactOutput(output);
  if (compact.length <= maxLen) return compact;
  return compact.slice(0, maxLen).trimEnd() + '…';
}

/**
 * Check if output indicates an error.
 */
export function isErrorOutput(output: string): boolean {
  if (!output) return false;
  const lower = output.toLowerCase();
  return lower.includes('error') || lower.includes('failed') || lower.includes('exception') || lower.includes('traceback');
}

/**
 * Extract error message from output.
 */
export function extractErrorMessage(output: string): string | null {
  if (!isErrorOutput(output)) return null;
  const lines = output.split('\n');
  const errorLine = lines.find(l => /error|failed|exception/i.test(l));
  return errorLine?.trim() || output.slice(0, 200);
}
