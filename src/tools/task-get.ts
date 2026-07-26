/**
 * Kairo — TaskGet Tool
 */

import type { ToolDefinition, ToolResult } from './types.js'
import { getTask, getTaskListId } from '../tasks/index.js'

export const taskGetTool: ToolDefinition = {
  name: 'task_get',
  description: 'Retrieve task details by ID',
  prompt: `Get full details of a task by its ID.

Usage:
- task_get <task-id> — retrieve task details`,
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

      const lines = [
        `Task #${task.id}`,
        `Subject: ${task.subject}`,
        `Status: ${task.status}`,
        `Description: ${task.description}`,
      ]
      if (task.activeForm) lines.push(`Active Form: ${task.activeForm}`)
      if (task.owner) lines.push(`Owner: ${task.owner}`)
      if (task.blocks.length > 0) lines.push(`Blocks: ${task.blocks.join(', ')}`)
      if (task.blockedBy.length > 0) lines.push(`Blocked By: ${task.blockedBy.join(', ')}`)
      if (task.output) lines.push(`Output: ${task.output}`)
      lines.push(`Created: ${task.createdAt}`)
      lines.push(`Updated: ${task.updatedAt}`)
      if (task.completedAt) lines.push(`Completed: ${task.completedAt}`)

      return { output: lines.join('\n'), success: true }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
