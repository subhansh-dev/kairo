/**
 * Web tools — web fetching and search utilities.
 */

export interface WebFetchOptions {
  url: string;
  maxChars?: number;
  extractMode?: 'text' | 'markdown';
  timeout?: number;
}

export interface WebSearchOptions {
  query: string;
  limit?: number;
  provider?: string;
}

/**
 * Build a web fetch request.
 */
export function buildWebFetchRequest(opts: WebFetchOptions): RequestInit {
  return {
    method: 'GET',
    headers: {
      'User-Agent': 'Kairo/1.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: opts.timeout ? AbortSignal.timeout(opts.timeout) : undefined,
  };
}

/**
 * Extract readable text from HTML.
 */
export function extractTextFromHtml(html: string): string {
  // Simple HTML tag stripping
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * Extract links from HTML.
 */
export function extractLinksFromHtml(html: string, baseUrl?: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    let url = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();

    // Resolve relative URLs
    if (baseUrl && url.startsWith('/')) {
      try {
        url = new URL(url, baseUrl).toString();
      } catch { /* keep original */ }
    }

    if (url && text) {
      links.push({ text, url });
    }
  }

  return links;
}

/**
 * Check if a URL is safe to fetch.
 */
export function isUrlSafeToFetch(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) return false;
    if (parsed.hostname.startsWith('192.168.') || parsed.hostname.startsWith('10.')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Format web content for tool output.
 */
export function formatWebContent(text: string, maxLen = 10_000): string {
  if (!text) return '(empty)';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n… [truncated]';
}
