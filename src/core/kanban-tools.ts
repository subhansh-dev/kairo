/**
 * Kanban tools — task board management.
 */

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  tags: string[];
}

// In-memory kanban board
const tasks = new Map<string, KanbanTask>();

/**
 * Create a new kanban task.
 */
export function createKanbanTask(opts: { title: string; description?: string; priority?: KanbanTask['priority']; tags?: string[] }): KanbanTask {
  const task: KanbanTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: opts.title,
    description: opts.description,
    status: 'todo',
    priority: opts.priority || 'medium',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: opts.tags || [],
  };
  tasks.set(task.id, task);
  return task;
}

/**
 * Get all kanban tasks.
 */
export function getKanbanTasks(status?: KanbanTask['status']): KanbanTask[] {
  const all = [...tasks.values()];
  if (status) return all.filter(t => t.status === status);
  return all;
}

/**
 * Update a task's status.
 */
export function updateKanbanTaskStatus(id: string, status: KanbanTask['status']): boolean {
  const task = tasks.get(id);
  if (!task) return false;
  task.status = status;
  task.updatedAt = Date.now();
  if (status === 'done') task.completedAt = Date.now();
  return true;
}

/**
 * Get a task by ID.
 */
export function getKanbanTask(id: string): KanbanTask | undefined {
  return tasks.get(id);
}

/**
 * Format kanban board for display.
 */
export function formatKanbanBoard(): string {
  const columns = {
    todo: getKanbanTasks('todo'),
    in_progress: getKanbanTasks('in_progress'),
    done: getKanbanTasks('done').slice(-5), // Last 5
    blocked: getKanbanTasks('blocked'),
  };

  const lines: string[] = [];
  const priorityIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };

  for (const [status, columnTasks] of Object.entries(columns)) {
    if (columnTasks.length === 0) continue;
    const label = status.replace('_', ' ').toUpperCase();
    lines.push(`\n${label} (${columnTasks.length}):`);
    for (const task of columnTasks) {
      lines.push(`  ${priorityIcon[task.priority]} ${task.title}${task.tags.length ? ` [${task.tags.join(', ')}]` : ''}`);
    }
  }

  return lines.join('\n') || 'No tasks on the board.';
}

/**
 * Clear all tasks.
 */
export function clearKanbanBoard(): void {
  tasks.clear();
}
