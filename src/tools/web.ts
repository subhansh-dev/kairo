/**
 * Kairo — Web Tools (WebFetch + WebSearch)
 * Providers: DuckDuckGo (default), Brave, Tavily, Exa (with API keys)
 */

import type { ToolDefinition, ToolResult } from './types.js';
import { searchWithFallback, getConfiguredProviders } from './search-providers.js';
import { checkSsrf } from '../engine/ssrf.js';

// ─── WebFetch ───────────────────────────────────────────────────

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch a URL and convert to markdown. Returns the page content.',
  prompt: `Fetches a URL, converts the page to markdown, and optionally extracts relevant content.

Usage:
- web_fetch <url> — fetch and return full page as markdown
- web_fetch <url> <prompt> — fetch and extract relevant content based on prompt

HTTP is upgraded to HTTPS. Cross-host redirects are returned.`,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (http:// or https://)',
      },
      prompt: {
        type: 'string',
        description: 'Optional: extract only content relevant to this prompt',
      },
    },
    required: ['url'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const parts = args.split(/\s+/);
      const url = parts[0];
      const prompt = parts.slice(1).join(' ');

      if (!url) return { output: 'Usage: web_fetch <url> [prompt]', success: false };

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
      } catch {
        return { output: `Error: Invalid URL: ${url}`, success: false };
      }

      // SSRF protection: block requests to internal IPs
      try {
        await checkSsrf(parsedUrl.toString());
      } catch (e) {
        return { output: `Error: ${(e as Error).message}`, success: false };
      }

      const resp = await fetch(parsedUrl.toString(), {
        headers: {
          'User-Agent': 'Kairo/0.3.0 (coding-agent)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'manual', // Check each redirect manually for SSRF safety
      });

      // Handle redirects with SSRF checks on each hop
      let finalResp = resp;
      let redirectCount = 0;
      while (finalResp.status >= 300 && finalResp.status < 400 && redirectCount < 5) {
        const location = finalResp.headers.get('location');
        if (!location) break;
        const redirectUrl = new URL(location, parsedUrl.toString());
        try {
          await checkSsrf(redirectUrl.toString());
        } catch (e) {
          return { output: `Error: Redirect to internal IP blocked: ${(e as Error).message}`, success: false }; 
        }
        finalResp = await fetch(redirectUrl.toString(), {
          headers: {
            'User-Agent': 'Kairo/0.3.0 (coding-agent)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(15000),
          redirect: 'manual',
        });
        parsedUrl = redirectUrl;
        redirectCount++;
      }

      if (finalResp.status >= 300 && finalResp.status < 400) {
        return { output: 'Error: Too many redirects', success: false }; 
      }

      if (!finalResp.ok) {
        return { output: `Error: HTTP ${finalResp.status} ${finalResp.statusText}`, success: false }; 
      }

      const contentType = finalResp.headers.get('content-type') || '';
      const text = await finalResp.text();

      // Basic HTML to markdown conversion
      let markdown = text;
      if (contentType.includes('text/html')) {
        markdown = htmlToMarkdown(text);
      }

      // Truncate if too long
      const maxLen = 10000;
      if (markdown.length > maxLen) {
        markdown = markdown.slice(0, maxLen) + '\n\n[... truncated]';
      }

      return {
        output: `# ${parsedUrl.hostname}\n\n${markdown}`,
        success: true,
        metadata: { url: parsedUrl.toString(), contentType, length: markdown.length },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};

function htmlToMarkdown(html: string): string {
  let md = html;
  // Remove scripts, styles, nav, footer
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  md = md.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  md = md.replace(/<header[\s\S]*?<\/header>/gi, '');
  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n');
  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  // Bold/italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  // Code
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```');
  // Paragraphs and breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<div[^>]*>(.*?)<\/div>/gi, '$1\n');
  // Lists
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<[ou]l[^>]*>([\s\S]*?)<\/[ou]l>/gi, '$1\n');
  // Images
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');
  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');
  // Decode entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');
  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.replace(/[ \t]+/g, ' ');
  return md.trim();
}

// ─── WebSearch ──────────────────────────────────────────────────

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for real-time information. Returns titles, URLs, and descriptions.',
  prompt: `Search the web using available search providers. Returns result blocks with titles and URLs.

Usage:
- web_search <query> — search for the query

Uses DuckDuckGo by default (no API key needed).`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string',
      },
    },
    required: ['query'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string, signal?: AbortSignal): Promise<ToolResult> => {
    try {
      const query = args.trim();
      if (!query) return { output: 'Usage: web_search <query>', success: false };

      const configured = getConfiguredProviders();
      const result = await searchWithFallback({ query }, signal);

      if (result.hits.length > 0) {
        const output = result.hits.map(r => `**${r.title}**\n${r.url}\n${r.description || ''}`).join('\n\n');
        return {
          output,
          success: true,
          metadata: { provider: result.providerName, results: result.hits.length, configured },
        };
      }

      return { output: 'No results found.', success: true };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};

