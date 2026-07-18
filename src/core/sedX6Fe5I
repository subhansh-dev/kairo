/**
 * Website policy — check website policies for scraping.
 */

export interface WebsitePolicy {
  url: string;
  hasRobotsTxt: boolean;
  allowsScraping: boolean;
  crawlDelay?: number;
  disallowedPaths: string[];
  note?: string;
}

/**
 * Check if scraping is allowed for a URL.
 */
export function isScrapingAllowed(url: string): { allowed: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    // Always allow known API endpoints
    if (parsed.pathname.includes('/api/')) return { allowed: true };

    // Block scraping of login/auth pages
    const blockedPaths = ['/login', '/signin', '/auth', '/oauth', '/account'];
    if (blockedPaths.some(p => parsed.pathname.toLowerCase().includes(p))) {
      return { allowed: false, reason: 'Authentication pages should not be scraped' };
    }

    // Allow scraping by default (robots.txt checking would require a fetch)
    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }
}

/**
 * Build a robots.txt URL from a base URL.
 */
export function getRobotsTxtUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/robots.txt`;
  } catch {
    return null;
  }
}

/**
 * Parse a robots.txt file.
 */
export function parseRobotsTxt(content: string): { disallowedPaths: string[]; crawlDelay?: number } {
  const disallowedPaths: string[] = [];
  let crawlDelay: number | undefined;

  const lines = content.split('\n');
  let isUserAgent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    const [directive, ...valueParts] = trimmed.split(':');
    const value = valueParts.join(':').trim();

    if (directive.toLowerCase() === 'user-agent') {
      isUserAgent = value === '*' || value.toLowerCase().includes('kairo');
    } else if (isUserAgent && directive.toLowerCase() === 'disallow') {
      if (value) disallowedPaths.push(value);
    } else if (directive.toLowerCase() === 'crawl-delay') {
      crawlDelay = parseFloat(value);
    }
  }

  return { disallowedPaths, crawlDelay };
}
