/**
 * Stdio safe — safe stdio utilities with error handling.
 */

/**
 * Wrap a write stream to silently handle errors.
 */
export function wrapSafeStream(stream: NodeJS.WriteStream): NodeJS.WriteStream {
  const originalWrite = stream.write.bind(stream);

  (stream as any).write = (data: any) => {
    try {
      return originalWrite(data);
    } catch {
      return false;
    }
  };

  return stream;
}

/**
 * Check if stdout is a TTY.
 */
export function isStdoutTTY(): boolean {
  return process.stdout.isTTY ?? false;
}

/**
 * Check if stderr is a TTY.
 */
export function isStderrTTY(): boolean {
  return process.stderr.isTTY ?? false;
}

/**
 * Get terminal width.
 */
export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Get terminal height.
 */
export function getTerminalHeight(): number {
  return process.stdout.rows || 24;
}

/**
 * Clear the current line.
 */
export function clearLine(): void {
  process.stdout.write('\r' + ' '.repeat(getTerminalWidth()) + '\r');
}

/**
 * Move cursor to beginning of line.
 */
export function cursorToStart(): void {
  process.stdout.write('\r');
}

/**
 * Hide cursor.
 */
export function hideCursor(): void {
  process.stdout.write('\x1b[?25l');
}

/**
 * Show cursor.
 */
export function showCursor(): void {
  process.stdout.write('\x1b[?25h');
}
