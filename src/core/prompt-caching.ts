/**
 * Kairo — Prompt Caching
 * Anthropic prompt caching strategy.
 * Ported from Hermes Agent's prompt_caching.py
 *
 * Reduces input token costs by ~75% on multi-turn conversations.
 */

// ─── Cache Control ──────────────────────────────────────────────

const CACHE_MARKER = { type: 'ephemeral' };
const LONG_CACHE_MARKER = { type: 'ephemeral', ttl: '1h' };

/**
 * Apply Anthropic prompt caching to messages.
 * Caches system prompt + last 3 non-system messages.
 */
export function applyAnthropicCacheControl(
  messages: any[],
  longTtl: boolean = false,
): any[] {
  const marker = longTtl ? LONG_CACHE_MARKER : CACHE_MARKER;
  const result = messages.map(m => ({ ...m }));

  // Find last 3 non-system messages
  const nonSystemIndices: number[] = [];
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role !== 'system') {
      nonSystemIndices.push(i);
      if (nonSystemIndices.length >= 3) break;
    }
  }

  // Apply cache markers
  for (const idx of nonSystemIndices) {
    const msg = result[idx];
    if (typeof msg.content === 'string') {
      msg.content = [
        { type: 'text', text: msg.content, cache_control: marker },
      ];
    } else if (Array.isArray(msg.content)) {
      // Add marker to last content block
      const lastBlock = msg.content[msg.content.length - 1];
      if (lastBlock) {
        lastBlock.cache_control = marker;
      }
    }
  }

  return result;
}

/**
 * Check if a provider supports prompt caching.
 */
export function supportsPromptCaching(provider: string): boolean {
  return provider === 'anthropic';
}
