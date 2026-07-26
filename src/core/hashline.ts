/**
 * Hashline — hash-based line tracking for file edits.
 */

import { createHash } from 'crypto';

/**
 * Compute a hash of a line for conflict detection.
 */
export function hashLine(line: string): string {
  return createHash('sha256').update(line).digest('hex').slice(0, 8);
}

/**
 * Compute hashes for all lines in content.
 */
export function hashContent(content: string): string[] {
  return content.split('\n').map(hashLine);
}

/**
 * Verify that specific lines haven't changed.
 */
export function verifyLines(content: string, lineHashes: Array<{ line: number; hash: string }>): { valid: boolean; conflicts: number[] } {
  const lines = content.split('\n');
  const conflicts: number[] = [];

  for (const { line, hash } of lineHashes) {
    if (line < 0 || line >= lines.length || hashLine(lines[line]) !== hash) {
      conflicts.push(line);
    }
  }

  return { valid: conflicts.length === 0, conflicts };
}

/**
 * Build a hash anchor for a specific region of content.
 */
export function buildHashAnchor(content: string, startLine: number, endLine: number): Array<{ line: number; hash: string }> {
  const lines = content.split('\n');
  const anchors: Array<{ line: number; hash: string }> = [];
  for (let i = startLine; i <= Math.min(endLine, lines.length - 1); i++) {
    anchors.push({ line: i, hash: hashLine(lines[i]) });
  }
  return anchors;
}
