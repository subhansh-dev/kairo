/**
 * CJK/wide-character-aware re-alignment of markdown tables.
 *
 * Models pad markdown tables assuming each character occupies one terminal cell.
 * CJK glyphs and most emoji render as two cells, so the model's spacing collapses.
 * This module rebuilds row padding using display-column widths.
 */

const DIVIDER_CELL_RE = /^\s*:?-{3,}:?\s*$/;
const MIN_COL_WIDTH = 3;

/**
 * Get the display width of a string, accounting for CJK characters.
 * CJK characters occupy 2 cells; regular chars occupy 1.
 */
function displayWidth(s: string): number {
  let width = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // CJK Unified Ideographs, CJK Compatibility, etc.
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified
      (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Extension A
      (code >= 0x3000 && code <= 0x303F) ||  // CJK Symbols
      (code >= 0xFF00 && code <= 0xFFEF) ||  // Fullwidth Forms
      (code >= 0x2E80 && code <= 0x2EFF) ||  // CJK Radicals
      (code >= 0xFE30 && code <= 0xFE4F) ||  // CJK Compat Forms
      (code >= 0x20000 && code <= 0x2A6DF)   // CJK Extension B
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad a string to a target display width.
 */
function padToWidth(s: string, targetWidth: number, padChar = ' '): string {
  const current = displayWidth(s);
  const padding = Math.max(0, targetWidth - current);
  return s + padChar.repeat(padding);
}

/**
 * Check if a line looks like a markdown table divider row.
 */
export function isTableDivider(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length < 2) return false;
  return cells.every(cell => DIVIDER_CELL_RE.test(cell));
}

/**
 * Check if a line looks like a markdown table row.
 */
export function looksLikeTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|', 1);
}

/**
 * Split a table row into cells.
 */
export function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  // Remove leading and trailing pipes, then split
  const inner = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined);
  return inner.split('|').map(cell => cell.trim());
}

/**
 * Realign a markdown table block for proper CJK display.
 * Takes an array of lines that form a table and returns realigned lines.
 */
export function realignMarkdownTable(lines: string[]): string[] {
  if (lines.length < 2) return lines;

  // Parse all rows
  const rows = lines.map(line => splitTableRow(line));
  if (rows.some(r => r.length === 0)) return lines; // not a real table

  // Find max columns
  const maxCols = Math.max(...rows.map(r => r.length));

  // Calculate column widths
  const colWidths = new Array(maxCols).fill(MIN_COL_WIDTH);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i], displayWidth(row[i]));
    }
  }

  // Rebuild rows with proper padding
  return rows.map((row, rowIdx) => {
    // Divider row: use dashes
    if (row.length > 0 && isTableDivider(lines[rowIdx])) {
      const cells = colWidths.map(w => '-'.repeat(w));
      return '| ' + cells.join(' | ') + ' |';
    }
    // Normal row: pad cells
    const cells = colWidths.map((w, i) => {
      const cell = row[i] || '';
      return padToWidth(cell, w);
    });
    return '| ' + cells.join(' | ') + ' |';
  });
}

/**
 * Process a stream of text and realign any markdown tables found.
 * Handles tables that may be split across multiple calls.
 */
export function realignTablesInText(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let tableBuffer: string[] = [];

  for (const line of lines) {
    if (looksLikeTableRow(line)) {
      tableBuffer.push(line);
    } else {
      if (tableBuffer.length > 0) {
        result.push(...realignMarkdownTable(tableBuffer));
        tableBuffer = [];
      }
      result.push(line);
    }
  }

  if (tableBuffer.length > 0) {
    result.push(...realignMarkdownTable(tableBuffer));
  }

  return result.join('\n');
}
