/**
 * X Search — search X/Twitter posts.
 */

export interface XSearchResult {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  url: string;
  likes: number;
  retweets: number;
  replies: number;
}

export interface XSearchOptions {
  query: string;
  limit?: number;
  sort?: 'latest' | 'popular';
  from?: string;
  to?: string;
}

/**
 * Build an X search query.
 */
export function buildXSearchQuery(opts: XSearchOptions): string {
  let query = opts.query;
  if (opts.from) query += ` from:${opts.from}`;
  if (opts.to) query += ` to:${opts.to}`;
  return query;
}

/**
 * Format X search results for display.
 */
export function formatXSearchResults(results: XSearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  return results.map(r => {
    const stats = `❤️ ${r.likes} 🔄 ${r.retweets} 💬 ${r.replies}`;
    return `@${r.author} (${new Date(r.createdAt).toLocaleDateString()}):\n${r.text}\n${stats}\n${r.url}`;
  }).join('\n\n---\n\n');
}

/**
 * Extract hashtags from text.
 */
export function extractHashtags(text: string): string[] {
  const matches = text.match(/#\w+/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Extract mentions from text.
 */
export function extractMentions(text: string): string[] {
  const matches = text.match(/@\w+/g);
  return matches ? [...new Set(matches)] : [];
}
