/**
 * Session search — search across sessions.
 */

export interface SessionSearchResult {
  sessionId: string;
  title?: string;
  matchType: 'message' | 'title' | 'tool';
  matchedContent: string;
  relevance: number;
  timestamp?: number;
}

/**
 * Build a session search query.
 */
export function buildSessionSearchQuery(query: string, opts: { sessionId?: string; limit?: number } = {}): Record<string, unknown> {
  return {
    query,
    sessionId: opts.sessionId,
    limit: opts.limit || 10,
  };
}

/**
 * Format session search results for display.
 */
export function formatSessionSearchResults(results: SessionSearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  return results.map(r => {
    const title = r.title || r.sessionId;
    const preview = r.matchedContent.length > 150 ? r.matchedContent.slice(0, 150) + '…' : r.matchedContent;
    const time = r.timestamp ? new Date(r.timestamp).toLocaleString() : '';
    return `[${r.matchType}] ${title}${time ? ` (${time})` : ''}\n  ${preview}`;
  }).join('\n\n');
}

/**
 * Calculate relevance score for a search result.
 */
export function calculateRelevance(query: string, content: string): number {
  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();

  // Exact match
  if (contentLower.includes(queryLower)) {
    return 0.5 + (queryLower.length / contentLower.length) * 0.5;
  }

  // Word match
  const queryWords = queryLower.split(/\s+/);
  const matchedWords = queryWords.filter(w => contentLower.includes(w));
  if (matchedWords.length > 0) {
    return (matchedWords.length / queryWords.length) * 0.4;
  }

  return 0;
}
