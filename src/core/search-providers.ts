/**
 * Tool search providers — search for tools from external sources.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface SearchProvider {
  name: string;
  search: (query: string, limit?: number) => Promise<SearchResult[]>;
}

/**
 * Build a web search URL for a query.
 */
export function buildSearchUrl(query: string, provider = 'google'): string {
  const encoded = encodeURIComponent(query);
  const urls: Record<string, string> = {
    google: `https://www.google.com/search?q=${encoded}`,
    duckduckgo: `https://duckduckgo.com/?q=${encoded}`,
    bing: `https://www.bing.com/search?q=${encoded}`,
    github: `https://github.com/search?q=${encoded}`,
    stackoverflow: `https://stackoverflow.com/search?q=${encoded}`,
    npm: `https://www.npmjs.com/search?q=${encoded}`,
    pypi: `https://pypi.org/search/?q=${encoded}`,
  };
  return urls[provider] || urls.google;
}

/**
 * Format search results for display.
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
}

/**
 * Extract domain from URL.
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
