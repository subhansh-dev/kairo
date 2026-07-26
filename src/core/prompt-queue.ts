/**
 * Kairo — Prompt Queue
 * Queue and manage user prompts for sequential processing.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface QueuedPrompt {
  id: string;
  content: string;
  priority: number;
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

// ─── Queue ──────────────────────────────────────────────────────

export class PromptQueue {
  private queue: QueuedPrompt[] = [];
  private processing: QueuedPrompt | null = null;

  /**
   * Add a prompt to the queue.
   */
  enqueue(content: string, priority: number = 0): QueuedPrompt {
    const prompt: QueuedPrompt = {
      id: generateId(),
      content,
      priority,
      timestamp: Date.now(),
      status: 'pending',
    };
    this.queue.push(prompt);
    this.queue.sort((a, b) => b.priority - a.priority);
    return prompt;
  }

  /**
   * Get the next prompt to process.
   */
  dequeue(): QueuedPrompt | null {
    const next = this.queue.find(p => p.status === 'pending');
    if (next) {
      next.status = 'processing';
      this.processing = next;
    }
    return next || null;
  }

  /**
   * Mark the current prompt as completed.
   */
  complete(id: string): void {
    const prompt = this.queue.find(p => p.id === id);
    if (prompt) {
      prompt.status = 'completed';
      if (this.processing?.id === id) this.processing = null;
    }
  }

  /**
   * Mark the current prompt as failed.
   */
  fail(id: string): void {
    const prompt = this.queue.find(p => p.id === id);
    if (prompt) {
      prompt.status = 'failed';
      if (this.processing?.id === id) this.processing = null;
    }
  }

  /**
   * Get queue status.
   */
  getStatus(): { pending: number; processing: QueuedPrompt | null; completed: number; failed: number } {
    return {
      pending: this.queue.filter(p => p.status === 'pending').length,
      processing: this.processing,
      completed: this.queue.filter(p => p.status === 'completed').length,
      failed: this.queue.filter(p => p.status === 'failed').length,
    };
  }

  /**
   * Clear completed and failed prompts.
   */
  clearFinished(): void {
    this.queue = this.queue.filter(p => p.status === 'pending' || p.status === 'processing');
  }

  /**
   * Get all pending prompts.
   */
  getPending(): QueuedPrompt[] {
    return this.queue.filter(p => p.status === 'pending');
  }
}

function generateId(): string {
  return `pq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
