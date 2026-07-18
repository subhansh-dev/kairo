/**
 * Portal request tags — product attribution for provider requests.
 *
 * Every request that hits a provider must carry product-attribution tags.
 * Also manages ambient conversation context for auxiliary call sites.
 */

// Product attribution tags
const PRODUCT_TAG = 'product=kairo';

/**
 * Get the current Kairo version from package.json.
 */
function getVersion(): string {
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const CLIENT_TAG = `client=kairo-client-v${getVersion()}`;

/**
 * Get the standard request tags for provider attribution.
 */
export function getRequestTags(): string[] {
  return [PRODUCT_TAG, CLIENT_TAG];
}

/**
 * Get tags as a formatted string for display.
 */
export function getTagsString(): string {
  return getRequestTags().join(', ');
}

// ── Ambient conversation context ─────────────────────────────────────────────

let currentConversationId: string | undefined;

/**
 * Set the active conversation context for the current async scope.
 */
export function setConversationContext(conversationId: string | undefined): void {
  currentConversationId = conversationId || undefined;
}

/**
 * Get the current conversation context.
 */
export function getConversationContext(): string | undefined {
  return currentConversationId;
}

/**
 * Clear the conversation context.
 */
export function clearConversationContext(): void {
  currentConversationId = undefined;
}

/**
 * Run a function with a specific conversation context.
 */
export async function withConversationContext<T>(
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = currentConversationId;
  currentConversationId = conversationId;
  try {
    return await fn();
  } finally {
    currentConversationId = prev;
  }
}

/**
 * Build extra_body tags for provider requests.
 */
export function buildExtraBodyTags(sessionId?: string): Record<string, unknown> {
  const tags = getRequestTags();
  if (sessionId) {
    tags.push(`session=${sessionId}`);
  }
  return { tags };
}

/**
 * Format a conversation tag for a session.
 */
export function conversationTag(sessionId: string): string {
  return `conversation=${sessionId}`;
}
