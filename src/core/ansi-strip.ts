/**
 * ANSI strip — remove ANSI escape codes from strings.
 */

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Strip ANSI escape codes from a string.
 */
export function stripAnsi(text: string): string {
  if (!text) return text;
  return text.replace(ANSI_RE, '');
}

/**
 * Check if a string contains ANSI escape codes.
 */
export function hasAnsi(text: string): boolean {
  return ANSI_RE.test(text);
}

/**
 * Get the visible length of a string (excluding ANSI codes).
 */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Truncate a string to a maximum visible length, preserving ANSI codes.
 */
export function truncateWithAnsi(text: string, maxLen: number): string {
  if (visibleLength(text) <= maxLen) return text;
  let visible = 0;
  let i = 0;
  while (i < text.length && visible < maxLen) {
    const match = text.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
    if (match) {
      i += match[0].length;
    } else {
      i++;
      visible++;
    }
  }
  return text.slice(0, i) + '…';
}
