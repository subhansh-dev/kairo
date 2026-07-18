/**
 * TodoWrite tool implementation.
 *
 * Manages task lists with replace/merge modes.
 * Supports status tracking (pending/in_progress/completed/cancelled).
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  meta?: Record<string, unknown>;
}

export interface TodoUpdate {
  id: string;
  content?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
}

export class TodoState {
  private items: Map<string, TodoItem> = new Map();
  private order: string[] = [];

  clear(): void {
    this.items.clear();
    this.order = [];
  }

  push(id: string, item: TodoItem): void {
    if (!this.items.has(id)) {
      this.order.push(id);
    }
    this.items.set(id, item);
  }

  update(id: string, content: string | null, status: TodoStatus | null): boolean {
    const existing = this.items.get(id);
    if (!existing) return false;

    if (content !== null) existing.content = content;
    if (status !== null) existing.status = status;
    return true;
  }

  get(id: string): TodoItem | undefined {
    return this.items.get(id);
  }

  getAll(): TodoItem[] {
    return this.order.map(id => this.items.get(id)!).filter(Boolean);
  }

  isEmpty(): boolean {
    return this.items.size === 0;
  }

  size(): number {
    return this.items.size;
  }

  summary(): string {
    if (this.isEmpty()) return 'No tasks currently tracked.';

    const items = this.getAll();
    const pending = items.filter(i => i.status === 'pending');
    const inProgress = items.filter(i => i.status === 'in_progress');
    const completed = items.filter(i => i.status === 'completed');
    const cancelled = items.filter(i => i.status === 'cancelled');

    const lines: string[] = [];
    if (pending.length) lines.push(`Pending: ${pending.length}`);
    if (inProgress.length) lines.push(`In Progress: ${inProgress.length}`);
    if (completed.length) lines.push(`Completed: ${completed.length}`);
    if (cancelled.length) lines.push(`Cancelled: ${cancelled.length}`);

    return `Tasks (${items.length} total): ${lines.join(', ')}`;
  }
}

/**
 * Validate no duplicate IDs in updates.
 */
export function validateNoDuplicateIds(updates: TodoUpdate[]): string | null {
  const seen = new Set<string>();
  for (const u of updates) {
    if (seen.has(u.id)) return u.id;
    seen.add(u.id);
  }
  return null;
}

/**
 * Apply replace mode: incoming list fully replaces existing state.
 */
export function applyReplace(state: TodoState, updates: TodoUpdate[]): void {
  state.clear();
  for (const u of updates) {
    const content = u.content ?? u.id;
    const status = u.status ?? 'pending';
    state.push(u.id, {
      id: u.id,
      content,
      status,
      priority: u.priority ?? 'medium',
    });
  }
}

/**
 * Apply merge mode: updates merged into existing state.
 */
export function applyMerge(state: TodoState, updates: TodoUpdate[]): void {
  for (const u of updates) {
    if (state.update(u.id, u.content ?? null, u.status ?? null)) {
      continue;
    }
    // New item
    state.push(u.id, {
      id: u.id,
      content: u.content ?? u.id,
      status: u.status ?? 'pending',
      priority: u.priority ?? 'medium',
    });
  }
}

/**
 * Render todo state as formatted string.
 */
export function renderTodoState(state: TodoState): string {
  if (state.isEmpty()) return 'No tasks currently tracked.';

  const items = state.getAll();
  const lines: string[] = [];

  const statusIcons: Record<TodoStatus, string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  for (const item of items) {
    lines.push(`${statusIcons[item.status]} ${item.id}: ${item.content}`);
  }

  return lines.join('\n');
}
