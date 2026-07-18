/**
 * Task stop — stop/cancel running tasks.
 */

import { getTask, updateTaskStatus } from './task-tools.js';

export interface StopResult {
  success: boolean;
  taskId: string;
  message: string;
}

/**
 * Stop a running task.
 */
export function stopTask(taskId: string, reason?: string): StopResult {
  const task = getTask(taskId);
  if (!task) return { success: false, taskId, message: 'Task not found' };

  if (task.status !== 'running' && task.status !== 'pending') {
    return { success: false, taskId, message: `Task is ${task.status}, cannot stop` };
  }

  updateTaskStatus(taskId, 'cancelled', undefined, reason || 'Stopped by user');
  return { success: true, taskId, message: `Task "${task.title}" stopped` };
}

/**
 * Stop all running tasks.
 */
export function stopAllTasks(): StopResult[] {
  const running = [...getAllTasks()].filter(t => t.status === 'running' || t.status === 'pending');
  return running.map(t => stopTask(t.id, 'Stopped all tasks'));
}

/**
 * Check if a task can be stopped.
 */
export function canStopTask(taskId: string): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  return task.status === 'running' || task.status === 'pending';
}

function getAllTasks() {
  const { listTasks } = require('./task-tools.js');
  return listTasks();
}
