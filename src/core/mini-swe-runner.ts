/**
 * Mini SWE runner — Mini Software Engineering runner.
 */

export interface SWETask {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

/**
 * Create a SWE task.
 */
export function createSWETask(description: string): SWETask {
  return {
    id: `swe_${Date.now()}`,
    description,
    status: 'pending',
  };
}

/**
 * Format SWE task for display.
 */
export function formatSWETask(task: SWETask): string {
  const icon = { pending: '⏳', running: '🔄', completed: '✅', failed: '❌' };
  return `${icon[task.status]} ${task.description}${task.result ? `\n  ${task.result.slice(0, 200)}` : ''}`;
}
