/**
 * Task create/get/list — task management utilities.
 */

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  parentTaskId?: string;
  subtasks: string[];
}

// Task registry
const tasks = new Map<string, Task>();

/**
 * Create a new task.
 */
export function createTask(title: string, opts: { description?: string; priority?: Task['priority']; parentTaskId?: string } = {}): Task {
  const task: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    description: opts.description,
    status: 'pending',
    priority: opts.priority || 'medium',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    parentTaskId: opts.parentTaskId,
    subtasks: [],
  };
  tasks.set(task.id, task);

  // Add to parent's subtasks
  if (opts.parentTaskId) {
    const parent = tasks.get(opts.parentTaskId);
    if (parent) parent.subtasks.push(task.id);
  }

  return task;
}

/**
 * Get a task by ID.
 */
export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

/**
 * List all tasks.
 */
export function listTasks(status?: Task['status']): Task[] {
  const all = [...tasks.values()];
  if (status) return all.filter(t => t.status === status);
  return all;
}

/**
 * Update task status.
 */
export function updateTaskStatus(id: string, status: Task['status'], result?: string, error?: string): boolean {
  const task = tasks.get(id);
  if (!task) return false;
  task.status = status;
  task.updatedAt = Date.now();
  if (result) task.result = result;
  if (error) task.error = error;
  if (status === 'completed' || status === 'failed') task.completedAt = Date.now();
  return true;
}

/**
 * Format tasks for display.
 */
export function formatTasks(taskList: Task[]): string {
  if (taskList.length === 0) return 'No tasks.';

  const statusIcon = { pending: '⏳', running: '🔄', completed: '✅', failed: '❌', cancelled: '🚫' };
  const priorityIcon = { high: '🔴', medium: '🟡', low: '🟢' };

  return taskList.map(t =>
    `${statusIcon[t.status]} ${priorityIcon[t.priority]} ${t.title} (${t.id})`
  ).join('\n');
}

/**
 * Get task statistics.
 */
export function getTaskStats(): { total: number; pending: number; running: number; completed: number; failed: number } {
  const all = [...tasks.values()];
  return {
    total: all.length,
    pending: all.filter(t => t.status === 'pending').length,
    running: all.filter(t => t.status === 'running').length,
    completed: all.filter(t => t.status === 'completed').length,
    failed: all.filter(t => t.status === 'failed').length,
  };
}
