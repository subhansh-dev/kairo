/**
 * CLI output — formatted console output utilities.
 */

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
  console.log(`${GREEN}✅ ${message}${R}`);
}

/**
 * Print an error message.
 */
export function printError(message: string): void {
  console.error(`${RED}❌ ${message}${R}`);
}

/**
 * Print a warning message.
 */
export function printWarning(message: string): void {
  console.log(`${YELLOW}⚠️  ${message}${R}`);
}

/**
 * Print an info message.
 */
export function printInfo(message: string): void {
  console.log(`${BLUE}ℹ️  ${message}${R}`);
}

/**
 * Print a header.
 */
export function printHeader(text: string): void {
  console.log(`\n${B}${CYAN}${text}${R}`);
  console.log(`${D}${'─'.repeat(text.length)}${R}`);
}

/**
 * Print a key-value pair.
 */
export function printKeyValue(key: string, value: string, indent = 2): void {
  console.log(`${' '.repeat(indent)}${D}${key}:${R} ${value}`);
}

/**
 * Print a table row.
 */
export function printTableRow(columns: string[], widths: number[]): void {
  const row = columns.map((col, i) => col.padEnd(widths[i])).join('  ');
  console.log(`  ${row}`);
}

/**
 * Print a divider line.
 */
export function printDivider(width = 40): void {
  console.log(`${D}${'─'.repeat(width)}${R}`);
}

/**
 * Print a blank line.
 */
export function printBlank(): void {
  console.log();
}

/**
 * Clear the current line.
 */
export function clearLine(): void {
  process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
}

/**
 * Print inline status (overwrites current line).
 */
export function printStatus(message: string): void {
  process.stdout.write(`\r${CYAN}●${R} ${message}`);
}

/**
 * Print a spinner frame.
 */
export function printSpinner(frame: number, message: string): void {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  process.stdout.write(`\r${CYAN}${frames[frame % frames.length]}${R} ${message}`);
}
