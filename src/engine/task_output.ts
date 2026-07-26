/**
 * Task output — output/status for background tasks.
 *
 */

export interface TaskOutputResult {
  taskId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  error?: string;
  exitCode?: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface MultiTaskOutputResult {
  results: TaskOutputResult[];
  allCompleted: boolean;
}

export interface TaskOutputToolInput {
  taskIds: string[];
  timeoutMs?: number;
}

export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
export const MAX_WAIT_BLOCK_MS = 600_000; // 10 minutes

/**
 * Resolve effective wait timeout from user input.
 */
export function cappedWaitTimeout(timeoutMs?: number): number {
  const base = timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  return Math.min(base, MAX_WAIT_BLOCK_MS);
}

/**
 * Format task output for display.
 */
export function formatTaskOutput(result: TaskOutputResult): string {
  const lines: string[] = [];
  lines.push(`Task ${result.taskId}: ${result.status}`);

  if (result.output) {
    lines.push('--- Output ---');
    lines.push(result.output);
  }

  if (result.error) {
    lines.push('--- Error ---');
    lines.push(result.error);
  }

  if (result.exitCode !== undefined) {
    lines.push(`Exit code: ${result.exitCode}`);
  }

  if (result.durationMs !== undefined) {
    lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  return lines.join('\n');
}

/**
 * Format multi-task output.
 */
export function formatMultiTaskOutput(result: MultiTaskOutputResult): string {
  if (result.results.length === 0) return 'No tasks found.';

  const lines: string[] = [];
  lines.push(`Tasks: ${result.results.length} (${result.allCompleted ? 'all completed' : 'some running'})`);
  lines.push('');

  for (const task of result.results) {
    lines.push(formatTaskOutput(task));
    lines.push('');
  }

  return lines.join('\n');
}
