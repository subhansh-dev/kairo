/**
 * File attachment utilities — render file content for model consumption.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

const MAX_FILE_TOKENS = 5000;

export interface FileReference {
  path: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Parse a file reference string in the format @{file_path} or @{file_path}:L{start}-L{end}.
 */
export function parseFileReference(input: string): FileReference | null {
  const match = input.match(/^@?([^@].*?)(?::L?(\d+)-L?(\d+))?$/);
  if (!match) return null;

  return {
    path: match[1],
    startLine: match[2] ? parseInt(match[2], 10) : undefined,
    endLine: match[3] ? parseInt(match[3], 10) : undefined,
  };
}

/**
 * Render file content from a FileReference.
 */
export async function renderFileReference(
  fileRef: FileReference,
  isCursor = false
): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(fileRef.path, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  const lineOffset = fileRef.startLine ?? 1;
  const startIdx = Math.max(0, lineOffset - 1);
  const endIdx = fileRef.endLine ?? lines.length;
  const slicedLines = lines.slice(startIdx, endIdx);

  const rendered = slicedLines
    .map((line, i) => `${lineOffset + i}→${line}`)
    .join('\n');

  // Estimate tokens (rough: 1 token ≈ 4 chars)
  const estimatedTokens = Math.ceil(rendered.length / 4);
  if (estimatedTokens > MAX_FILE_TOKENS) {
    return `<metadata-only path="${fileRef.path}" tokens="${estimatedTokens}" />`;
  }

  if (isCursor) {
    return `<code_selection path="${fileRef.path}" lines="${lineOffset}-${endIdx}">\n${rendered}\n</code_selection>`;
  }

  return `<file_contents path="${fileRef.path}" startLine="${lineOffset}" endLine="${endIdx}" isFullFile="${!fileRef.startLine && !fileRef.endLine}">\n${rendered}\n</file_contents>`;
}

/**
 * Content hash for dedup.
 */
export function contentHash(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}
