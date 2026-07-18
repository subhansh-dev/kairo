/**
 * Web search tool — calls web search API for up-to-date information.
 *
 */

export const WEB_SEARCH_TOOL_NAME = 'web_search';

export interface WebSearchInput {
  query: string;
  allowedDomains?: string[];
}

export interface WebSearchOutput {
  results: WebSearchResult[];
  query: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

export interface WebSearchClient {
  search(query: string, options?: { allowedDomains?: string[] }): Promise<WebSearchOutput>;
}

/**
 * Create a web search client with the given API key and base URL.
 */
export function createWebSearchClient(config: {
  apiKey?: string;
  baseUrl?: string;
}): WebSearchClient {
  return {
    async search(query, options) {
      // Simplified implementation — in production this would call
      // the actual web search API
      return {
        results: [],
        query,
      };
    },
  };
}
