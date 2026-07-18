/**
 * X/Twitter API — X/Twitter API integration.
 */

export interface XPost {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
  };
}

/**
 * Build an X API request.
 */
export function buildXApiRequest(endpoint: string, params: Record<string, string> = {}): Record<string, unknown> {
  return {
    endpoint,
    params,
  };
}

/**
 * Format an X post for display.
 */
export function formatXPost(post: XPost): string {
  const stats = `❤️ ${post.metrics.likes} 🔄 ${post.metrics.retweets} 💬 ${post.metrics.replies}`;
  return `@${post.author} (${new Date(post.createdAt).toLocaleDateString()}):\n${post.text}\n${stats}`;
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

/**
 * Truncate text for X post (280 chars).
 */
export function truncateForX(text: string, url?: string): string {
  const maxLen = url ? 280 - url.length - 1 : 280;
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
