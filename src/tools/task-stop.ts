/**
 * Kairo — TaskStop Tool
 */

import type { ToolDefinition, ToolResult } from './types.js'
import { updateTask, getTaskListId } from '../tasks/index.js'

export const taskStopTool: ToolDefinition = {
  name: 'task_stop',
  description: 'Stop a running task',
  prompt: `Stop a running or pending task.

Usage:
- task_stop <task-id> — stop and mark task as completed`,
  tier: 'write',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const taskId = args.trim()
      if (!taskId) return { output: 'Error: task ID is required', success: false }

      const task = updateTask(getTaskListId(), taskId, { status: 'completed' })
      if (!task) return { output: `Task not found: ${taskId}`, success: false }

      return {
        output: `Task #${task.id} stopped: ${task.subject}`,
        success: true,
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
