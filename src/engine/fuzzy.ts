/**
 * Fuzzy file matching using simple scoring.
 *
 * Provides fast file path matching without external dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'target', '__pycache__', '.next', 'dist',
  'build', '.cache', '.parcel-cache', 'coverage',
]);

export interface FuzzyMatchResult {
  path: string;
  score: number;
  indices: number[];
  isDir: boolean;
}

/**
 * Simple fuzzy matching score.
 * Higher score = better match.
 */
function fuzzyScore(query: string, target: string): { score: number; indices: number[] } {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact match
  if (targetLower === queryLower) return { score: 1000, indices: Array.from({ length: query.length }, (_, i) => i) };

  // Prefix match
  if (targetLower.startsWith(queryLower)) {
    return { score: 800, indices: Array.from({ length: query.length }, (_, i) => i) };
  }

  // Contains match
  const containsIdx = targetLower.indexOf(queryLower);
  if (containsIdx !== -1) {
    return {
      score: 600 - containsIdx,
      indices: Array.from({ length: query.length }, (_, i) => containsIdx + i),
    };
  }

  // Character-by-character fuzzy match
  let queryIdx = 0;
  let score = 0;
  const indices: number[] = [];
  let lastMatchIdx = -10;
  let consecutiveBonus = 0;

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      indices.push(i);

      // Consecutive match bonus
      if (i === lastMatchIdx + 1) {
        consecutiveBonus += 5;
      } else {
        consecutiveBonus = 0;
      }

      // Word boundary bonus
      if (i === 0 || target[i - 1] === '/' || target[i - 1] === '_' || target[i - 1] === '-' || target[i - 1] === '.') {
        score += 10;
      }

      score += 1 + consecutiveBonus;
      lastMatchIdx = i;
      queryIdx++;
    }
  }

  if (queryIdx === queryLower.length) {
    return { score, indices };
  }

  return { score: 0, indices: [] };
}

/**
 * Fuzzy search files in a directory.
 */
export function fuzzySearchFiles(
  rootPath: string,
  query: string,
  options: { maxResults?: number; includeDirs?: boolean } = {}
): FuzzyMatchResult[] {
  const maxResults = options.maxResults ?? 20;
  const results: FuzzyMatchResult[] = [];

  function walk(dir: string, relativeTo: string) {
    if (results.length >= maxResults * 2) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults * 2) return;
      if (entry.name.startsWith('.')) continue;
      if (EXCLUDE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(relativeTo, fullPath);

      const { score, indices } = fuzzyScore(query, relPath);
      if (score > 0) {
        results.push({
          path: relPath,
          score,
          indices,
          isDir: entry.isDirectory(),
        });
      }

      if (entry.isDirectory()) {
        walk(fullPath, relativeTo);
      }
    }
  }

  walk(rootPath, rootPath);

  // Sort by score descending, take top results
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

/**
 * Fuzzy match a single path against a query.
 */
export function fuzzyMatchPath(query: string, target: string): FuzzyMatchResult | null {
  const { score, indices } = fuzzyScore(query, target);
  if (score === 0) return null;

  return {
    path: target,
    score,
    indices,
    isDir: false,
  };
}
