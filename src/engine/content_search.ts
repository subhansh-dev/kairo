/**
 * Content search — streaming ripgrep-based content search.
 *
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export interface ContentSearchParams {
  pattern: string;
  caseInsensitive?: boolean;
  literal?: boolean;
  globs?: string[];
  maxFiles?: number;
  maxMatches?: number;
  respectGitignore?: boolean;
}

export interface ContentMatch {
  line: number;
  content: string;
  matchStart?: number;
  matchEnd?: number;
}

export interface ContentMatchFile {
  path: string;
  matches: ContentMatch[];
}

export interface ContentSearchData {
  files: ContentMatchFile[];
  totalMatches: number;
  totalFiles: number;
  truncated: boolean;
}

export interface ContentSearchBatch {
  files: ContentMatchFile[];
  totalMatches: number;
  totalFiles: number;
  done: boolean;
  truncated: boolean;
}

const BATCH_INTERVAL_MS = 50;
const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_MATCHES = 1000;

const DEFAULT_EXCLUSIONS = ['!.git/**', '!submodules/**', '!vendor/**'];

function buildRipgrepArgs(root: string, params: ContentSearchParams): string[] {
  const args: string[] = ['--json', '--line-number'];

  for (const glob of DEFAULT_EXCLUSIONS) {
    args.push('--glob', glob);
  }

  args.push('--max-filesize', '1M');
  args.push('--max-count', '50');
  args.push('--max-columns', '500');
  args.push('--max-columns-preview');

  if (params.caseInsensitive) {
    args.push('--ignore-case');
  }
  if (params.literal) {
    args.push('--fixed-strings');
  }
  if (params.respectGitignore === false) {
    args.push('--no-ignore');
  }
  for (const glob of (params.globs || [])) {
    args.push('--glob', glob);
  }

  args.push('-e', params.pattern);
  args.push('.');

  return args;
}

function parseMatchFromJson(data: any): ContentMatch | null {
  if (typeof data !== 'object' || data === null) return null;

  const lineNum = data.line_number;
  if (typeof lineNum !== 'number') return null;

  const content = data.lines?.text?.trimEnd?.() ?? '';
  let matchStart: number | undefined;
  let matchEnd: number | undefined;

  if (Array.isArray(data.submatches) && data.submatches.length > 0) {
    matchStart = data.submatches[0].start;
    matchEnd = data.submatches[0].end;
  }

  return { line: lineNum, content, matchStart, matchEnd };
}

function parseFilePathFromJson(root: string, data: any): string | null {
  const text = data?.data?.path?.text;
  if (typeof text !== 'string') return null;

  const normalized = text.startsWith('./') ? text.substring(2) : text;
  if (path.isAbsolute(normalized)) return normalized;
  return path.join(root, normalized);
}

/**
 * Streaming content search with batched status notifications.
 * Set cancel to true to abort the search early.
 */
export async function contentSearchStreaming(
  root: string,
  params: ContentSearchParams,
  cancel: { value: boolean },
  onStatus?: (batch: ContentSearchBatch) => void
): Promise<ContentSearchData> {
  const maxFiles = params.maxFiles ?? DEFAULT_MAX_FILES;
  const maxMatches = params.maxMatches ?? DEFAULT_MAX_MATCHES;

  const args = buildRipgrepArgs(root, params);
  const proc = spawn('rg', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const files: ContentMatchFile[] = [];
  let totalMatches = 0;
  let totalFiles = 0;
  let truncated = false;

  return new Promise<ContentSearchData>((resolve, reject) => {
    let buffer = '';
    let lastBatchTime = Date.now();
    let currentFile: ContentMatchFile | null = null;

    const flushBatch = () => {
      if (onStatus && (files.length > 0 || totalMatches > 0)) {
        onStatus({
          files: [...files],
          totalMatches,
          totalFiles,
          done: false,
          truncated,
        });
      }
      lastBatchTime = Date.now();
    };

    proc.stdout!.on('data', (chunk: Buffer) => {
      if (cancel.value) {
        proc.kill();
        return;
      }

      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        if (data.type === 'begin') {
          const filePath = parseFilePathFromJson(root, data);
          if (filePath) {
            currentFile = { path: filePath, matches: [] };
          }
        } else if (data.type === 'match') {
          const match = parseMatchFromJson(data);
          if (match && currentFile) {
            currentFile.matches.push(match);
            totalMatches++;

            if (totalMatches >= maxMatches) {
              truncated = true;
              proc.kill();
              return;
            }
          }
        } else if (data.type === 'end') {
          if (currentFile && currentFile.matches.length > 0) {
            files.push(currentFile);
            totalFiles++;

            if (totalFiles >= maxFiles) {
              truncated = true;
              proc.kill();
              return;
            }
          }
          currentFile = null;
        }
      }

      // Batch status updates
      if (Date.now() - lastBatchTime >= BATCH_INTERVAL_MS) {
        flushBatch();
      }
    });

    proc.stdout!.on('end', () => {
      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.type === 'match') {
            const match = parseMatchFromJson(data);
            if (match && currentFile) {
              currentFile.matches.push(match);
              totalMatches++;
            }
          }
        } catch { /* ignore */ }
      }

      // Final file
      if (currentFile && currentFile.matches.length > 0) {
        files.push(currentFile);
        totalFiles++;
      }

      flushBatch();
    });

    proc.on('error', (err) => {
      // If rg is not found, try to use grep as fallback
      if ((err as any).code === 'ENOENT') {
        reject(new Error('ripgrep (rg) not found. Install it from https://github.com/BurntSushi/ripgrep'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      resolve({ files, totalMatches, totalFiles, truncated });
    });
  });
}

/**
 * Simple non-streaming content search.
 */
export async function contentSearch(
  root: string,
  params: ContentSearchParams
): Promise<ContentSearchData> {
  return contentSearchStreaming(root, params, { value: false });
}
