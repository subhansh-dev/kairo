/**
 * Enhanced WebFetch implementation with SSRF protection.
 *
 * Client-side URL fetching with HTML-to-markdown conversion,
 * domain allowlisting, and SSRF protection.
 */

import { checkSsrf } from './ssrf';
import { DomainMatcher, normalizeDomain } from './domain';

export interface WebFetchParams {
  allowedDomains?: string[];
  proxyEndpoint?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  userAgent?: string;
}

export interface WebFetchOutput {
  content: string;
  url: string;
  contentType?: string;
  truncated: boolean;
  statusCode: number;
}

/**
 * Strip HTML tags and convert to readable markdown-like text.
 */
function htmlToMarkdown(html: string): string {
  let text = html;

  // Remove script and style elements
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Convert block elements to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<\/blockquote>/gi, '\n\n');

  // Convert headings
  text = text.replace(/<h1[^>]*>/gi, '# ');
  text = text.replace(/<h2[^>]*>/gi, '## ');
  text = text.replace(/<h3[^>]*>/gi, '### ');
  text = text.replace(/<h4[^>]*>/gi, '#### ');
  text = text.replace(/<h5[^>]*>/gi, '##### ');
  text = text.replace(/<h6[^>]*>/gi, '###### ');

  // Convert links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert bold/italic
  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // Convert code
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Convert lists
  text = text.replace(/<li[^>]*>/gi, '- ');

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.split('\n').map(l => l.trimEnd()).join('\n');

  return text.trim();
}

const DEFAULT_USER_AGENT = 'KairoBot/1.0 (+https://kairo.ai)';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024; // 1MB

export async function runWebFetch(
  url: string,
  params: WebFetchParams = {},
  cwd?: string
): Promise<WebFetchOutput> {
  const timeoutMs = params.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxBytes = params.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES;
  const userAgent = params.userAgent || DEFAULT_USER_AGENT;

  // SSRF check
  await checkSsrf(url);

  // Domain allowlist check
  if (params.allowedDomains && params.allowedDomains.length > 0) {
    const matcher = new DomainMatcher(params.allowedDomains);
    if (!matcher.isAllowed(url)) {
      throw new Error(`Domain not in allowlist: ${DomainMatcher.domainFromUrl(url)}`);
    }
  }

  // Upgrade HTTP to HTTPS
  const fetchUrl = url.startsWith('http://') ? url.replace('http://', 'https://') : url;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/markdown, text/html, text/plain, */*',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    // Truncate if too large
    let content = rawText;
    let truncated = false;
    if (content.length > maxBytes) {
      content = content.slice(0, maxBytes);
      truncated = true;
    }

    // Convert HTML to markdown if needed
    if (contentType.includes('text/html')) {
      content = htmlToMarkdown(content);
    }

    // Truncate to reasonable length for context
    const MAX_CHARS = 50_000;
    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS) + '\n\n[Content truncated]';
      truncated = true;
    }

    return {
      content,
      url: fetchUrl,
      contentType,
      truncated,
      statusCode: response.status,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
