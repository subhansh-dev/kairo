/**
 * Input sanitize — sanitize user input.
 */

/**
 * Sanitize user input for safe processing.
 */
export function sanitizeInput(input: string): string {
  if (!input) return input;

  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');

  // Normalize line endings
  sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Strip ANSI escape codes
  sanitized = sanitized.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  return sanitized;
}

/**
 * Sanitize input for use in shell commands.
 */
export function sanitizeForShell(input: string): string {
  // Remove dangerous characters
  return input
    .replace(/[;&|`$(){}!<>]/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

/**
 * Sanitize input for use as a file path.
 */
export function sanitizeForPath(input: string): string {
  // Remove path traversal attempts
  return input
    .replace(/\.\./g, '')
    .replace(/~/g, '')
    .replace(/[;&|`$(){}!<>]/g, '')
    .trim();
}

/**
 * Sanitize input for display (prevent terminal injection).
 */
export function sanitizeForDisplay(input: string): string {
  if (!input) return input;

  // Remove ANSI escape codes
  let sanitized = input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  // Remove control characters except newline and tab
  sanitized = sanitized.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

  return sanitized;
}

/**
 * Truncate input to a maximum length.
 */
export function truncateInput(input: string, maxLen: number): string {
  if (!input || input.length <= maxLen) return input;
  return input.slice(0, maxLen) + '… [truncated]';
}

/**
 * Check if input contains potentially dangerous content.
 */
export function hasDangerousContent(input: string): boolean {
  const dangerous = [
    /\x1b\[/,  // ANSI escape sequences
    /\0/,       // Null bytes
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/, // Control characters
  ];
  return dangerous.some(p => p.test(input));
}
