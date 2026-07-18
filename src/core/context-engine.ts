/**
 * Kairo — Context Engine
 * Abstract base class for pluggable context engines.
 * Ported from Hermes Agent's context_engine.py
 */

// ─── Types ──────────────────────────────────────────────────────

export interface ContextEngineResult {
  messages: any[];
  systemPrompt: string;
  tokensUsed: number;
  compressed: boolean;
}

// ─── Base Class ─────────────────────────────────────────────────

/**
 * A context engine controls how conversation context is managed
 * when approaching the model's token limit.
 */
export abstract class ContextEngineBase {
  abstract readonly name: string;

  /**
   * Called when a conversation begins.
   */
  abstract onSessionStart(): void;

  /**
   * Called after each API response with usage data.
   */
  abstract updateFromResponse(inputTokens: number, outputTokens: number): void;

  /**
   * Check if compaction should fire.
   */
  abstract shouldCompress(): boolean;

  /**
   * Perform compaction.
   */
  abstract compress(messages: any[], systemPrompt: string): ContextEngineResult;

  /**
   * Called at session end.
   */
  abstract onSessionEnd(): void;
}

// ─── Default Compressor ─────────────────────────────────────────

export class DefaultContextEngine extends ContextEngineBase {
  readonly name = 'default';
  private contextLength: number;
  private compressThreshold: number;
  private currentTokens: number = 0;

  constructor(contextLength: number = 128000) {
    super();
    this.contextLength = contextLength;
    this.compressThreshold = Math.floor(contextLength * 0.75); // 75% threshold
  }

  onSessionStart(): void {
    this.currentTokens = 0;
  }

  updateFromResponse(inputTokens: number, outputTokens: number): void {
    this.currentTokens = inputTokens + outputTokens;
  }

  shouldCompress(): boolean {
    return this.currentTokens > this.compressThreshold;
  }

  compress(messages: any[], systemPrompt: string): ContextEngineResult {
    if (messages.length <= 4) {
      return { messages, systemPrompt, tokensUsed: this.currentTokens, compressed: false };
    }

    // Keep first 2 messages (system + first user) and last 4 messages
    const head = messages.slice(0, 2);
    const tail = messages.slice(-4);
    const middle = messages.slice(2, -4);

    // Summarize middle messages
    const summary = this.summarizeMiddle(middle);

    const compressed = [
      ...head,
      { role: 'system', content: `[Context summary of ${middle.length} messages]\n${summary}` },
      ...tail,
    ];

    this.currentTokens = Math.floor(this.currentTokens * 0.5);

    return {
      messages: compressed,
      systemPrompt,
      tokensUsed: this.currentTokens,
      compressed: true,
    };
  }

  onSessionEnd(): void {
    this.currentTokens = 0;
  }

  private summarizeMiddle(messages: any[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const preview = content.slice(0, 200);
      if (msg.role === 'assistant') {
        lines.push(`Assistant: ${preview}`);
      } else if (msg.role === 'user') {
        lines.push(`User: ${preview}`);
      } else if (msg.role === 'tool') {
        lines.push(`Tool result: ${preview.slice(0, 100)}`);
      }
    }
    return lines.join('\n');
  }
}
