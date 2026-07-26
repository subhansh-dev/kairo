/**
 * Task update — update task properties.
 */

import { getTask } from './task-tools.js';

/**
 * Update task title.
 */
export function updateTaskTitle(taskId: string, title: string): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  task.title = title;
  task.updatedAt = Date.now();
  return true;
}

/**
 * Update task description.
 */
export function updateTaskDescription(taskId: string, description: string): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  task.description = description;
  task.updatedAt = Date.now();
  return true;
}

/**
 * Update task priority.
 */
export function updateTaskPriority(taskId: string, priority: 'low' | 'medium' | 'high'): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  task.priority = priority;
  task.updatedAt = Date.now();
  return true;
}

/**
 * Update task result.
 */
export function updateTaskResult(taskId: string, result: string): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  task.result = result;
  task.updatedAt = Date.now();
  return true;
}
