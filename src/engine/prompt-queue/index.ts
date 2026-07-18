/**
 * Prompt queue — request queuing for sequential LLM calls.
 */

export type PromptStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PromptRequest {
  id: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  priority: number;
  createdAt: Date;
  status: PromptStatus;
  result?: string;
  error?: string;
}

export interface PromptQueue {
  enqueue(request: Omit<PromptRequest, 'id' | 'createdAt' | 'status'>): string;
  dequeue(): PromptRequest | undefined;
  peek(): PromptRequest | undefined;
  size(): number;
  cancel(id: string): boolean;
  get(id: string): PromptRequest | undefined;
  list(status?: PromptStatus): PromptRequest[];
  clear(): void;
}

/**
 * Create a prompt queue.
 */
export function createPromptQueue(): PromptQueue {
  const queue: PromptRequest[] = [];

  return {
    enqueue(request) {
      const id = crypto.randomUUID();
      const entry: PromptRequest = {
        ...request,
        id,
        createdAt: new Date(),
        status: 'pending',
      };
      queue.push(entry);
      queue.sort((a, b) => b.priority - a.priority);
      return id;
    },

    dequeue() {
      const idx = queue.findIndex(r => r.status === 'pending');
      if (idx === -1) return undefined;
      const [request] = queue.splice(idx, 1);
      request.status = 'running';
      return request;
    },

    peek() {
      return queue.find(r => r.status === 'pending');
    },

    size() {
      return queue.filter(r => r.status === 'pending').length;
    },

    cancel(id) {
      const request = queue.find(r => r.id === id && r.status === 'pending');
      if (request) {
        request.status = 'cancelled';
        return true;
      }
      return false;
    },

    get(id) {
      return queue.find(r => r.id === id);
    },

    list(status) {
      return status ? queue.filter(r => r.status === status) : [...queue];
    },

    clear() {
      queue.length = 0;
    },
  };
}
