/**
 * Kairo — Thinking Stream Scanner
 * Extracts thinking content from providers that embed it in the text stream
 * rather than as a separate field. Handles Deepseek R1, Qwen, and other
 * models that use </think> * Reconstructs the final output by combining extracted thinking with the remaining text in the correct order.
 */

export interface ThinkingScanEvent {
  type: 'text' | 'thinking_delta' | 'thinking_end';
  text?: string;
  delta?: string;
  thinking?: string;
}

/**
 * Scans streamed text for thinking tags and emits structured events.
 * Handles: <think>...</think>, <thinking>...</thinking>
 */
export class ThinkingStreamScanner {
  private buffer = '';
  private closeTag = '';
  private thinking = '';
  private isOpen = false;

  /**
   * Feed new text delta into the scanner.
   * Returns events for thinking content and regular text.
   */
  feed(text: string): ThinkingScanEvent[] {
    if (text.length === 0) return [];
    this.buffer += text;
    return this.consume(false);
  }

  /**
   * Flush remaining buffer. Call when stream ends.
   */
  flush(): ThinkingScanEvent[] {
    const events = this.consume(true);
    if (this.buffer.length === 0) return events;

    if (this.isOpen) {
      // Still in thinking mode at end of stream
      this.thinking += this.buffer;
      events.push({ type: 'thinking_delta', delta: this.buffer });
      events.push({ type: 'thinking_end', thinking: this.thinking });
    } else {
      events.push({ type: 'text', text: this.buffer });
    }

    this.buffer = '';
    this.closeTag = '';
    this.isOpen = false;
    return events;
  }

  /** Reset scanner state. */
  reset(): void {
    this.buffer = '';
    this.closeTag = '';
    this.thinking = '';
    this.isOpen = false;
  }

  /** Whether we're currently inside a thinking block. */
  get inThinking(): boolean {
    return this.isOpen;
  }

  /** Get accumulated thinking content so far. */
  get thinkingContent(): string {
    return this.thinking;
  }

  private consume(final: boolean): ThinkingScanEvent[] {
    const events: ThinkingScanEvent[] = [];

    while (this.buffer.length > 0) {
      if (this.isOpen) {
        // Inside thinking — look for close tag
        const closeIdx = this.buffer.indexOf(this.closeTag);
        if (closeIdx === -1) {
          if (final) {
            // End of stream while still in thinking
            this.thinking += this.buffer;
            events.push({ type: 'thinking_delta', delta: this.buffer });
            this.buffer = '';
          }
          break;
        }

        // Found close tag
        const before = this.buffer.slice(0, closeIdx);
        if (before) {
          this.thinking += before;
          events.push({ type: 'thinking_delta', delta: before });
        }
        events.push({ type: 'thinking_end', thinking: this.thinking });
        this.buffer = this.buffer.slice(closeIdx + this.closeTag.length);
        this.isOpen = false;
        this.closeTag = '';
        this.thinking = '';
      } else {
        // Outside thinking — look for open tags
        const thinkIdx = this.buffer.indexOf('<think>');
        const thinkingIdx = this.buffer.indexOf('<thinking>');

        let openIdx = -1;
        let closeTag = '';

        if (thinkIdx !== -1 && (thinkingIdx === -1 || thinkIdx < thinkingIdx)) {
          openIdx = thinkIdx;
          closeTag = '</think>';
        } else if (thinkingIdx !== -1) {
          openIdx = thinkingIdx;
          closeTag = '</thinking>';
        }

        if (openIdx === -1) {
          // No thinking tag found
          if (final) {
            events.push({ type: 'text', text: this.buffer });
            this.buffer = '';
          }
          break;
        }

        // Found open tag
        const before = this.buffer.slice(0, openIdx);
        if (before) {
          events.push({ type: 'text', text: before });
        }
        this.buffer = this.buffer.slice(openIdx + (thinkIdx !== -1 ? 7 : 10)); // <think> or <thinking>
        this.isOpen = true;
        this.closeTag = closeTag;
        this.thinking = '';
      }
    }

    return events;
  }
}
