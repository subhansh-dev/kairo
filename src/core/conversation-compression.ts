/**
 * Kairo — Conversation Compression
 * Compress conversation history to fit context window.
 * Ported from Hermes Agent's conversation_compression.py
 */

import { estimateMessagesTokens } from './model-metadata.js';

// ─── Types ──────────────────────────────────────────────────────

export interface CompressionResult {
  messages: any[];
  tokensBefore: number;
  tokensAfter: number;
  strategy: string;
}

// ─── Compression Strategies ─────────────────────────────────────

/**
 * Smart compression: keep system + first user + tool calls + last N.
 */
export function smartCompress(messages: any[], maxTokens: number): CompressionResult {
  const tokensBefore = estimateMessagesTokens(
    messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
  );

  if (tokensBefore <= maxTokens) {
    return { messages, tokensBefore, tokensAfter: tokensBefore, strategy: 'none' };
  }

  // Keep: system messages, first user message, all tool calls, last 4 messages
  const system = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');
  const firstUser = nonSystem.find(m => m.role === 'user');
  const toolMessages = nonSystem.filter(m => m.role === 'tool');
  const last4 = nonSystem.slice(-4);

  // Build compressed set
  const kept = new Set<any>();
  for (const m of system) kept.add(m);
  if (firstUser) kept.add(firstUser);
  for (const m of toolMessages) kept.add(m);
  for (const m of last4) kept.add(m);

  const compressed = messages.filter(m => kept.has(m));

  // If still too long, summarize middle
  if (estimateMessagesTokens(compressed.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))) > maxTokens) {
    // Just keep system + last 6
    const minimal = [...system, ...nonSystem.slice(-6)];
    const tokensAfter = estimateMessagesTokens(minimal.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })));
    return { messages: minimal, tokensBefore, tokensAfter, strategy: 'aggressive' };
  }

  const tokensAfter = estimateMessagesTokens(compressed.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })));
  return { messages: compressed, tokensBefore, tokensAfter, strategy: 'smart' };
}

/**
 * Simple tail compression: keep first N and last M messages.
 */
export function tailCompress(messages: any[], headCount: number, tailCount: number): CompressionResult {
  const tokensBefore = estimateMessagesTokens(
    messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
  );

  if (messages.length <= headCount + tailCount) {
    return { messages, tokensBefore, tokensAfter: tokensBefore, strategy: 'none' };
  }

  const head = messages.slice(0, headCount);
  const tail = messages.slice(-tailCount);
  const summary = {
    role: 'system',
    content: `[${messages.length - headCount - tailCount} messages compressed]`,
  };

  const compressed = [...head, summary, ...tail];
  const tokensAfter = estimateMessagesTokens(compressed.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })));

  return { messages: compressed, tokensBefore, tokensAfter, strategy: 'tail' };
}
