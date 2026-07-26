/**
 * Fuzzy match — approximate string matching utilities.
 */

/**
 * Calculate the Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity ratio between two strings (0-1).
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Fuzzy find the best match for a query in a list of candidates.
 */
export function fuzzyFind(query: string, candidates: string[], threshold = 0.4): string | null {
  if (candidates.length === 0) return null;

  const lowerQuery = query.toLowerCase();
  let bestMatch: string | null = null;
  let bestScore = threshold;

  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase();

    // Exact match
    if (lowerCandidate === lowerQuery) return candidate;

    // Contains match
    if (lowerCandidate.includes(lowerQuery)) {
      const score = 0.5 + (lowerQuery.length / lowerCandidate.length) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
      continue;
    }

    // Prefix match
    if (lowerCandidate.startsWith(lowerQuery)) {
      const score = 0.6 + (lowerQuery.length / lowerCandidate.length) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
      continue;
    }

    // Levenshtein similarity
    const score = similarity(lowerQuery, lowerCandidate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

/**
 * Fuzzy find multiple matches, sorted by score.
 */
export function fuzzyFindAll(query: string, candidates: string[], threshold = 0.4, limit = 5): Array<{ match: string; score: number }> {
  const lowerQuery = query.toLowerCase();
  const results: Array<{ match: string; score: number }> = [];

  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase();
    let score = similarity(lowerQuery, lowerCandidate);
    if (lowerCandidate.includes(lowerQuery)) score = Math.max(score, 0.5 + (lowerQuery.length / lowerCandidate.length) * 0.5);
    if (lowerCandidate.startsWith(lowerQuery)) score = Math.max(score, 0.6);

    if (score >= threshold) {
      results.push({ match: candidate, score });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
