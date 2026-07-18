/**
 * Kairo — TaskOutput Tool
 */

import type { ToolDefinition, ToolResult } from './types.js'
import { getTask, getTaskListId } from '../tasks/index.js'

export const taskOutputTool: ToolDefinition = {
  name: 'task_output',
  description: 'Get output from a task',
  prompt: `Get the stored output from a completed or in-progress task.

Usage:
- task_output <task-id> — get task output`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const taskId = args.trim()
      if (!taskId) return { output: 'Error: task ID is required', success: false }

      const task = getTask(getTaskListId(), taskId)
      if (!task) return { output: `Task not found: ${taskId}`, success: false }

      if (!task.output) return { output: `Task #${task.id} has no output yet.`, success: true }
      return { output: task.output, success: true }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
