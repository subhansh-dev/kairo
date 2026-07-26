/**
 * Task output — get task output/results.
 */

import { getTask } from './task-tools.js';

export interface TaskOutput {
  taskId: string;
  title: string;
  status: string;
  result?: string;
  error?: string;
  duration?: number;
  subtaskOutputs?: TaskOutput[];
}

/**
 * Get the output of a task.
 */
export function getTaskOutput(taskId: string): TaskOutput | null {
  const task = getTask(taskId);
  if (!task) return null;

  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    result: task.result,
    error: task.error,
    duration: task.completedAt ? task.completedAt - task.createdAt : undefined,
    subtaskOutputs: task.subtasks.map(id => getTaskOutput(id)).filter(Boolean) as TaskOutput[],
  };
}

/**
 * Format task output for display.
 */
export function formatTaskOutput(output: TaskOutput, indent = 0): string {
  const prefix = '  '.repeat(indent);
  const statusIcon: Record<string, string> = {
    pending: '⏳', running: '🔄', completed: '✅', failed: '❌', cancelled: '🚫',
  };
  const lines = [`${prefix}${statusIcon[output.status] || '?'} ${output.title}`];

  if (output.result) {
    const preview = output.result.length > 200 ? output.result.slice(0, 200) + '…' : output.result;
    lines.push(`${prefix}  ${preview}`);
  }

  if (output.error) {
    lines.push(`${prefix}  Error: ${output.error}`);
  }

  if (output.duration) {
    lines.push(`${prefix}  Duration: ${(output.duration / 1000).toFixed(1)}s`);
  }

  if (output.subtaskOutputs && output.subtaskOutputs.length > 0) {
    for (const sub of output.subtaskOutputs) {
      lines.push(formatTaskOutput(sub, indent + 1));
    }
  }

  return lines.join('\n');
}
