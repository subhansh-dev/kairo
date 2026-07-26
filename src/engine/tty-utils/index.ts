/**
 * TTY utilities — terminal detection and formatting.
 */

export interface TtyInfo {
  isTty: boolean;
  columns: number;
  rows: number;
  supportsColor: boolean;
  supportsEmoji: boolean;
}

/**
 * Detect TTY capabilities.
 */
export function detectTty(): TtyInfo {
  const isTty = process.stdout?.isTTY ?? false;
  const columns = process.stdout?.columns ?? 80;
  const rows = process.stdout?.rows ?? 24;

  // Color support detection
  const term = process.env.TERM ?? '';
  const supportsColor = isTty && (
    term.includes('color') ||
    term.includes('256') ||
    !!process.env.COLORTERM ||
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.TERM_PROGRAM === 'vscode'
  );

  // Emoji support detection
  const supportsEmoji = supportsColor && process.platform !== 'win32';

  return { isTty, columns, rows, supportsColor, supportsEmoji };
}

/**
 * Truncate text to fit terminal width.
 */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Pad text to a target width.
 */
export function padRight(text: string, targetWidth: number, padChar: string = ' '): string {
  if (text.length >= targetWidth) return text;
  return text + padChar.repeat(targetWidth - text.length);
}

/**
 * Center text within a width.
 */
export function centerText(text: string, width: number, padChar: string = ' '): string {
  if (text.length >= width) return text;
  const leftPad = Math.floor((width - text.length) / 2);
  const rightPad = width - text.length - leftPad;
  return padChar.repeat(leftPad) + text + padChar.repeat(rightPad);
}

/**
 * Create a horizontal rule.
 */
export function horizontalRule(width: number = 60, char: string = '─'): string {
  return char.repeat(width);
}

/**
 * Strip ANSI escape codes from text.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Check if text contains ANSI codes.
 */
export function hasAnsi(text: string): boolean {
  return /\x1B\[[0-9;]*[a-zA-Z]/.test(text);
}
