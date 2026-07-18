/**
 * Kairo — Context Compressor
 * Automatic context window compression for long conversations.
 * Ported from Hermes Agent's context_compressor.py
 *
 * Uses auxiliary model (cheap/fast) to summarize middle turns
 * while protecting head and tail context.
 */

import { estimateMessagesTokens } from './model-metadata.js';
import { redactSecrets } from './redact.js';

// ─── Types ──────────────────────────────────────────────────────

export interface CompressionConfig {
  contextLength: number;
  compressAtPercent: number;
  summaryModel: string;
  maxSummaryTokens: number;
  protectHeadMessages: number;
  protectTailMessages: number;
}

export interface CompressionResult {
  messages: any[];
  originalTokens: number;
  compressedTokens: number;
  strategy: string;
}

const DEFAULT_CONFIG: CompressionConfig = {
  contextLength: 128000,
  compressAtPercent: 75,
  summaryModel: '',
  maxSummaryTokens: 1000,
  protectHeadMessages: 2,
  protectTailMessages: 4,
};

// ─── Compressor ─────────────────────────────────────────────────

export class ContextCompressor {
  private config: CompressionConfig;
  private currentTokens: number = 0;

  constructor(config: Partial<CompressionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update token count from API response.
   */
  updateTokens(inputTokens: number, outputTokens: number): void {
    this.currentTokens = inputTokens + outputTokens;
  }

  /**
   * Check if compression is needed.
   */
  shouldCompress(): boolean {
    const threshold = this.config.contextLength * (this.config.compressAtPercent / 100);
    return this.currentTokens > threshold;
  }

  /**
   * Compress the message history.
   */
  compress(messages: any[]): CompressionResult {
    const originalTokens = estimateMessagesTokens(
      messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
    );

    if (messages.length <= this.config.protectHeadMessages + this.config.protectTailMessages) {
      return { messages, originalTokens, compressedTokens: originalTokens, strategy: 'none' };
    }

    const head = messages.slice(0, this.config.protectHeadMessages);
    const tail = messages.slice(-this.config.protectTailMessages);
    const middle = messages.slice(this.config.protectHeadMessages, -this.config.protectTailMessages);

    // Summarize middle
    const summary = this.buildSummary(middle);

    const compressed = [
      ...head,
      { role: 'system', content: `[Context compressed: ${middle.length} messages summarized]\n${summary}` },
      ...tail,
    ];

    const compressedTokens = estimateMessagesTokens(
      compressed.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
    );

    this.currentTokens = compressedTokens;

    return {
      messages: compressed,
      originalTokens,
      compressedTokens,
      strategy: 'middle-summary',
    };
  }

  /**
   * Build a summary of middle messages.
   */
  private buildSummary(messages: any[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const redacted = redactSecrets(content);

      if (msg.role === 'user') {
        lines.push(`User: ${redacted.slice(0, 200)}`);
      } else if (msg.role === 'assistant') {
        lines.push(`Assistant: ${redacted.slice(0, 200)}`);
      } else if (msg.role === 'tool') {
        lines.push(`Tool [${msg.name || 'unknown'}]: ${redacted.slice(0, 100)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Prune tool outputs before compression (cheap pre-pass).
   */
  pruneToolOutputs(messages: any[], maxChars: number = 2000): any[] {
    return messages.map(m => {
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > maxChars) {
        return { ...m, content: m.content.slice(0, maxChars) + '\n[pruned]' };
      }
      return m;
    });
  }
}
