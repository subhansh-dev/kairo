/**
 * Enhanced ReadFile implementation.
 *
 * Supports line numbering, offset/limit, PDF/PPTX handling,
 * and streaming output.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export const MAX_NUM_TOKENS = 25_000;
export const MAX_LINES_READ = 1_000;
const STREAM_DELTA_TARGET_BYTES = 4 * 1024;

export interface ReadFileInput {
  target_file: string;
  offset?: number;
  limit?: number;
  pages?: string;
  format?: 'image' | 'text';
}

export interface FileLine {
  lineNumber: number;
  content: string;
}

export interface ReadFileOutput {
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
  filePath: string;
}

/**
 * Format lines with "LINE_NUMBER→LINE_CONTENT" format.
 */
export function formatLines(lines: FileLine[]): string {
  return lines.map(l => `${l.lineNumber}→${l.content}`).join('\n');
}

/**
 * Parse a page range string like "1-5", "3", "10-".
 */
export function parsePageRange(range: string): { start?: number; end?: number } | null {
  if (!range) return null;

  const match = range.trim().match(/^(\d+)?-(\d+)?$/);
  if (!match) {
    const single = parseInt(range, 10);
    if (!isNaN(single)) return { start: single, end: single };
    return null;
  }

  const start = match[1] ? parseInt(match[1], 10) : undefined;
  const end = match[2] ? parseInt(match[2], 10) : undefined;
  return { start, end };
}

/**
 * Check if a file is a PDF based on extension.
 */
export function isPdfFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pdf');
}

/**
 * Check if a file is a PowerPoint file.
 */
export function isPptxFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pptx');
}

/**
 * Check if a file is an image based on extension.
 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext);
}

/**
 * Check if a file is a Jupyter notebook.
 */
export function isNotebookFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.ipynb');
}

/**
 * Resolve a file path against a working directory.
 */
export function resolveFilePath(targetFile: string, cwd: string): string {
  if (path.isAbsolute(targetFile)) return targetFile;
  return path.resolve(cwd, targetFile);
}

/**
 * Read a file with line numbering and optional offset/limit.
 */
export async function readFileWithLines(
  filePath: string,
  offset?: number,
  limit?: number
): Promise<ReadFileOutput> {
  const content = await fs.readFile(filePath, 'utf-8');
  const allLines = content.split('\n');

  const startLine = offset || 1;
  const lineLimit = limit || MAX_LINES_READ;
  const endLine = Math.min(startLine + lineLimit - 1, allLines.length);

  const fileLines: FileLine[] = [];
  for (let i = startLine - 1; i < endLine && i < allLines.length; i++) {
    fileLines.push({
      lineNumber: i + 1,
      content: allLines[i],
    });
  }

  return {
    content: formatLines(fileLines),
    totalLines: allLines.length,
    startLine,
    endLine: Math.min(endLine, allLines.length),
    truncated: endLine < allLines.length,
    filePath,
  };
}

/**
 * Read a file and extract text content (handles text, notebooks).
 */
export async function readFileContent(
  filePath: string,
  cwd: string,
  options: { offset?: number; limit?: number } = {}
): Promise<ReadFileOutput> {
  const fullPath = resolveFilePath(filePath, cwd);

  if (isNotebookFile(fullPath)) {
    const content = await fs.readFile(fullPath, 'utf-8');
    return extractNotebookContent(content, fullPath);
  }

  return readFileWithLines(fullPath, options.offset, options.limit);
}

/**
 * Extract text content from a Jupyter notebook.
 */
function extractNotebookContent(content: string, filePath: string): ReadFileOutput {
  try {
    const notebook = JSON.parse(content);
    const cells: string[] = [];

    if (notebook.cells) {
      for (const cell of notebook.cells) {
        if (cell.cell_type === 'code' || cell.cell_type === 'markdown') {
          if (cell.source) {
            cells.push(`# ${cell.cell_type === 'code' ? 'Code Cell' : 'Markdown Cell'}\n${Array.isArray(cell.source) ? cell.source.join('') : cell.source}`);
          }
        }
      }
    }

    const text = cells.join('\n\n');
    const lines = text.split('\n');
    const fileLines: FileLine[] = lines.map((content, i) => ({
      lineNumber: i + 1,
      content,
    }));

    return {
      content: formatLines(fileLines),
      totalLines: lines.length,
      startLine: 1,
      endLine: lines.length,
      truncated: false,
      filePath,
    };
  } catch {
    return {
      content: `Error: Could not parse notebook file`,
      totalLines: 1,
      startLine: 1,
      endLine: 1,
      truncated: false,
      filePath,
    };
  }
}
