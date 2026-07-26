/**
 * Tool output limits — truncation and size management.
 */

const DEFAULT_MAX_OUTPUT_CHARS = 10_000;
const DEFAULT_MAX_LINE_LENGTH = 2_000;
const TRUNCATION_SUFFIX = '\n… [truncated]';

/**
 * Truncate tool output to a maximum character count.
 */
export function truncateToolOutput(output: string, maxChars = DEFAULT_MAX_OUTPUT_CHARS): string {
  if (!output || output.length <= maxChars) return output;
  return output.slice(0, maxChars) + TRUNCATION_SUFFIX;
}

/**
 * Truncate long lines within tool output.
 */
export function truncateLongLines(output: string, maxLineLength = DEFAULT_MAX_LINE_LENGTH): string {
  if (!output) return output;
  return output.split('\n').map(line => {
    if (line.length <= maxLineLength) return line;
    return line.slice(0, maxLineLength) + '… [line truncated]';
  }).join('\n');
}

/**
 * Compact tool output — remove excessive blank lines.
 */
export function compactOutput(output: string): string {
  if (!output) return output;
  // Replace 3+ consecutive newlines with 2
  return output.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Summarize a tool result for display.
 */
export function summarizeToolResult(output: string, maxLen = 200): string {
  if (!output) return '(empty)';
  const compact = compactOutput(output);
  if (compact.length <= maxLen) return compact;
  return compact.slice(0, maxLen).trimEnd() + '…';
}

/**
 * Check if tool output looks like an error.
 */
export function isErrorOutput(output: string): boolean {
  if (!output) return false;
  const lower = output.toLowerCase();
  return lower.includes('error') || lower.includes('failed') || lower.includes('exception') || lower.includes('traceback');
}
