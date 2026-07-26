// ─── Types ─────────────────────────────────────────────────

export type HunkSource =
  | { type: 'agent_edit'; promptIndex: number }
  | { type: 'external' };

export interface HunkLineInfo {
  oldStart: number;  // 1-indexed
  oldCount: number;
  newStart: number;  // 1-indexed
  newCount: number;
}

export interface Hunk {
  id: string;
  path: string;
  lineInfo: HunkLineInfo;
  source: HunkSource;
  oldText: string | null;
  newText: string;
  createdAt: Date;
  selected: boolean;
}

const CONTEXT_LINES = 3;
const MAX_DIFF_FILE_SIZE = 1024 * 1024; // 1 MB

// ─── Diff Algorithm ────────────────────────────────────────

interface DiffChange {
  tag: 'equal' | 'delete' | 'insert';
  value: string;
}

/**
 * Compute line-based diff between two strings.
 * Simple LCS-based diff (not Myers, but good enough for most cases).
 */
function computeLineDiff(oldText: string, newText: string): DiffChange[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // LCS computation
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find changes
  const changes: DiffChange[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      changes.unshift({ tag: 'equal', value: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ tag: 'insert', value: newLines[j - 1] });
      j--;
    } else {
      changes.unshift({ tag: 'delete', value: oldLines[i - 1] });
      i--;
    }
  }

  return changes;
}

/**
 * Compute hunks by diffing baseline against current content.
 */
export function computeHunks(
  path: string,
  baseline: string,
  current: string,
  source: HunkSource,
): Hunk[] {
  if (baseline === current) return [];
  if (baseline.length > MAX_DIFF_FILE_SIZE || current.length > MAX_DIFF_FILE_SIZE) return [];

  const changes = computeLineDiff(baseline, current);
  const hunks: Hunk[] = [];
  let oldLine = 1;
  let newLine = 1;

  let currentHunk: { oldStart: number; newStart: number; oldLines: string[]; newLines: string[] } | null = null;

  for (const change of changes) {
    switch (change.tag) {
      case 'equal':
        if (currentHunk) {
          hunks.push(buildHunk(path, currentHunk, source));
          currentHunk = null;
        }
        oldLine++;
        newLine++;
        break;
      case 'delete':
        if (!currentHunk) {
          currentHunk = { oldStart: oldLine, newStart: newLine, oldLines: [], newLines: [] };
        }
        currentHunk.oldLines.push(change.value);
        oldLine++;
        break;
      case 'insert':
        if (!currentHunk) {
          currentHunk = { oldStart: oldLine, newStart: newLine, oldLines: [], newLines: [] };
        }
        currentHunk.newLines.push(change.value);
        newLine++;
        break;
    }
  }

  if (currentHunk) {
    hunks.push(buildHunk(path, currentHunk, source));
  }

  return hunks;
}

function buildHunk(
  path: string,
  builder: { oldStart: number; newStart: number; oldLines: string[]; newLines: string[] },
  source: HunkSource,
): Hunk {
  return {
    id: crypto.randomUUID(),
    path,
    lineInfo: {
      oldStart: builder.oldStart,
      oldCount: builder.oldLines.length,
      newStart: builder.newStart,
      newCount: builder.newLines.length,
    },
    source,
    oldText: builder.oldLines.length > 0 ? builder.oldLines.join('\n') + '\n' : null,
    newText: builder.newLines.join('\n') + (builder.newLines.length > 0 ? '\n' : ''),
    createdAt: new Date(),
    selected: false,
  };
}

// ─── Patch Generation ──────────────────────────────────────

/**
 * Generate a unified diff patch string.
 */
export function generateUnifiedPatch(path: string, baseline: string, current: string): string | null {
  if (baseline === current) return null;
  if (baseline.length > MAX_DIFF_FILE_SIZE || current.length > MAX_DIFF_FILE_SIZE) return null;

  const hunks = computeHunks(path, baseline, current, { type: 'external' });
  if (hunks.length === 0) return null;

  let output = `--- a/${path}\n+++ b/${path}\n`;

  for (const hunk of hunks) {
    output += formatHunkHeader(hunk.lineInfo);
    if (hunk.oldText) {
      for (const line of hunk.oldText.split('\n').filter(Boolean)) {
        output += `-${line}\n`;
      }
    }
    for (const line of hunk.newText.split('\n').filter(Boolean)) {
      output += `+${line}\n`;
    }
  }

  return output;
}

/**
 * Generate a hunk patch fragment with context lines.
 */
export function generateHunkPatch(
  baseline: string,
  current: string,
  hunk: Hunk,
): string {
  const oldLines = baseline.split('\n');
  const newLines = current.split('\n');
  let output = '';

  const oldStartIdx = hunk.lineInfo.oldStart - 1;
  const newStartIdx = hunk.lineInfo.newStart - 1;

  const contextBeforeStart = Math.max(0, oldStartIdx - CONTEXT_LINES);
  const contextBeforeEnd = oldStartIdx;

  const changesEndNew = newStartIdx + hunk.lineInfo.newCount;
  const contextAfterStart = changesEndNew;
  const contextAfterEnd = Math.min(newLines.length, changesEndNew + CONTEXT_LINES);

  const changesEndOld = oldStartIdx + hunk.lineInfo.oldCount;
  const contextAfterStartOld = changesEndOld;
  const contextAfterEndOld = Math.min(oldLines.length, changesEndOld + CONTEXT_LINES);

  const totalOldLines = (contextBeforeEnd - contextBeforeStart)
    + hunk.lineInfo.oldCount
    + (contextAfterEndOld - contextAfterStartOld);
  const totalNewLines = (contextBeforeEnd - contextBeforeStart)
    + hunk.lineInfo.newCount
    + (contextAfterEnd - contextAfterStart);

  output += `@@ -${contextBeforeStart + 1},${totalOldLines} +${contextBeforeStart + 1},${totalNewLines} @@\n`;

  for (let i = contextBeforeStart; i < contextBeforeEnd; i++) {
    if (oldLines[i] !== undefined) output += ` ${oldLines[i]}\n`;
  }

  if (hunk.oldText) {
    for (const line of hunk.oldText.split('\n').filter(Boolean)) {
      output += `-${line}\n`;
    }
  }

  for (const line of hunk.newText.split('\n').filter(Boolean)) {
    output += `+${line}\n`;
  }

  for (let i = contextAfterStart; i < contextAfterEnd; i++) {
    if (newLines[i] !== undefined) output += ` ${newLines[i]}\n`;
  }

  return output;
}

// ─── Patching ──────────────────────────────────────────────

/**
 * Replace lines in content starting at startLine (1-indexed).
 */
export function patchLines(
  content: string,
  startLine: number,
  removeCount: number,
  insertText: string,
): string {
  const lines = content.split('\n');
  const startIdx = Math.max(0, startLine - 1);

  const result = lines.slice(0, startIdx);

  if (insertText) {
    result.push(...insertText.split('\n'));
  }

  const endIdx = Math.min(lines.length, startIdx + removeCount);
  result.push(...lines.slice(endIdx));

  let output = result.join('\n');
  if (content.endsWith('\n') && output) {
    output += '\n';
  }
  return output;
}

// ─── Hunk Matching ─────────────────────────────────────────

/** Compare two hunks for content equality */
export function hunksMatchContent(a: Hunk, b: Hunk): boolean {
  return a.path === b.path && a.oldText === b.oldText && a.newText === b.newText;
}

/** Check if two hunks overlap by line range */
export function hunksOverlap(a: Hunk, b: Hunk): boolean {
  if (a.path !== b.path) return false;

  if (a.lineInfo.oldCount === 0 && b.lineInfo.oldCount === 0) {
    return a.lineInfo.oldStart === b.lineInfo.oldStart;
  }

  const aStart = a.lineInfo.oldStart;
  const aEnd = a.lineInfo.oldStart + a.lineInfo.oldCount;
  const bStart = b.lineInfo.oldStart;
  const bEnd = b.lineInfo.oldStart + b.lineInfo.oldCount;

  if (a.lineInfo.oldCount === 0) return aStart >= bStart && aStart <= bEnd;
  if (b.lineInfo.oldCount === 0) return bStart >= aStart && bStart <= aEnd;

  return !(aEnd < bStart || bEnd < aStart);
}

/** Calculate overlap size between two hunk line infos */
function calculateOverlapSize(a: HunkLineInfo, b: HunkLineInfo): number {
  const overlapStart = Math.max(a.oldStart, b.oldStart);
  const overlapEnd = Math.min(a.oldStart + a.oldCount, b.oldStart + b.oldCount);
  return Math.max(0, overlapEnd - overlapStart);
}

/** Find the best matching old hunk for a new hunk */
export function findMatchingOldHunk(
  newHunk: Hunk,
  oldHunks: Hunk[],
): Hunk | null {
  const contentMatches = oldHunks.filter(o => hunksMatchContent(o, newHunk));

  if (contentMatches.length > 0) {
    return contentMatches.reduce((best, o) => {
      const bestDist = Math.abs(best.lineInfo.newStart - newHunk.lineInfo.newStart);
      const oDist = Math.abs(o.lineInfo.newStart - newHunk.lineInfo.newStart);
      return oDist < bestDist ? o : best;
    });
  }

  const overlapping = oldHunks.filter(o => hunksOverlap(o, newHunk));
  if (overlapping.length === 0) return null;

  return overlapping.reduce((best, o) => {
    const bestOverlap = calculateOverlapSize(best.lineInfo, newHunk.lineInfo);
    const oOverlap = calculateOverlapSize(o.lineInfo, newHunk.lineInfo);
    return oOverlap > bestOverlap ? o : best;
  });
}

// ─── Helpers ───────────────────────────────────────────────

function formatHunkHeader(info: HunkLineInfo): string {
  return `@@ -${info.oldStart},${info.oldCount} +${info.newStart},${info.newCount} @@\n`;
}
