/**
 * Kill task tool — terminates running background tasks.
 *
 * Supports both bash processes and subagent sessions.
 */

export interface KillTaskInput {
  task_id: string;
  reason?: string;
}

export interface KillTaskOutput {
  success: boolean;
  message: string;
}

/**
 * Kill a background task.
 */
export function killTask(input: KillTaskInput): KillTaskOutput {
  const { task_id, reason } = input;

  // Try to kill as a process
  try {
    const pid = parseInt(task_id, 10);
    if (!isNaN(pid)) {
      process.kill(pid, 'SIGTERM');
      return {
        success: true,
        message: `Terminated process ${pid}${reason ? `: ${reason}` : ''}`,
      };
    }
  } catch { /* */ }

  // Try to kill as a monitor
  const { killMonitor } = require('./monitor.js');
  if (killMonitor(task_id)) {
    return {
      success: true,
      message: `Terminated monitor ${task_id}${reason ? `: ${reason}` : ''}`,
    };
  }

  return {
    success: false,
    message: `Task ${task_id} not found or already terminated`,
  };
}

/**
 * Kill a terminal command by process group.
 */
export function killTerminalCommand(taskId: string): KillTaskOutput {
  try {
    const pid = parseInt(taskId, 10);
    if (!isNaN(pid)) {
      // Send SIGTERM to process group
      process.kill(-pid, 'SIGTERM');
      return {
        success: true,
        message: `Terminated process group ${pid}`,
      };
    }
  } catch { /* */ }

  return {
    success: false,
    message: `Terminal command ${taskId} not found`,
  };
}
