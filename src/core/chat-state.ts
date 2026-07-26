/**
 * Kairo — Chat State
 * Conversation state management.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatStateConfig {
  maxMessages: number;
  maxTokens: number;
  pruningStrategy: 'tail' | 'smart' | 'none';
}

const DEFAULT_CONFIG: ChatStateConfig = {
  maxMessages: 200,
  maxTokens: 128000,
  pruningStrategy: 'smart',
};

// ─── Chat State ─────────────────────────────────────────────────

export class ChatState {
  private messages: ChatMessage[] = [];
  private config: ChatStateConfig;
  private tokenEstimate: number = 0;

  constructor(config: Partial<ChatStateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a message to the conversation.
   */
  push(message: ChatMessage): void {
    this.messages.push(message);
    this.tokenEstimate += estimateTokens(message.content);
    this.maybePrune();
  }

  /**
   * Get all messages.
   */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * Get the last N messages.
   */
  getLast(n: number): ChatMessage[] {
    return this.messages.slice(-n);
  }

  /**
   * Replace all messages.
   */
  replace(messages: ChatMessage[]): void {
    this.messages = [...messages];
    this.tokenEstimate = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.messages = [];
    this.tokenEstimate = 0;
  }

  /**
   * Get a snapshot of the current state.
   */
  snapshot(): { messages: ChatMessage[]; tokenEstimate: number; messageCount: number } {
    return {
      messages: [...this.messages],
      tokenEstimate: this.tokenEstimate,
      messageCount: this.messages.length,
    };
  }

  /**
   * Replace a range of messages (for compaction).
   */
  replaceRange(start: number, end: number, replacement: ChatMessage[]): void {
    this.messages.splice(start, end - start, ...replacement);
    this.tokenEstimate = this.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }

  /**
   * Maybe prune old messages.
   */
  private maybePrune(): void {
    if (this.messages.length <= this.config.maxMessages) return;
    if (this.tokenEstimate <= this.config.maxTokens) return;

    switch (this.config.pruningStrategy) {
      case 'tail':
        // Keep first and last N messages
        const keep = Math.floor(this.config.maxMessages / 2);
        this.messages = [
          ...this.messages.slice(0, keep),
          ...this.messages.slice(-keep),
        ];
        break;
      case 'smart':
        // Keep system + first user + last N
        const system = this.messages.filter(m => m.role === 'system');
        const nonSystem = this.messages.filter(m => m.role !== 'system');
        const tail = nonSystem.slice(-this.config.maxMessages + system.length);
        this.messages = [...system, ...tail];
        break;
      case 'none':
        break;
    }

    this.tokenEstimate = this.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
