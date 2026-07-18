/**
 * Kairo — TaskUpdate Tool
 */

import type { ToolDefinition, ToolResult } from './types.js'
import { updateTask, getTaskListId } from '../tasks/index.js'
import type { TaskStatus } from '../tasks/index.js'

export const taskUpdateTool: ToolDefinition = {
  name: 'task_update',
  description: 'Update task status, add dependencies, change owner',
  prompt: `Update a task's status, subject, description, or dependencies.

Usage:
- task_update <id> status:in_progress — mark as in progress
- task_update <id> status:completed — mark as completed
- task_update <id> owner:agent-name — assign to an agent
- task_update <id> addBlockedBy:<other-id> — add dependency
- task_update <id> addBlocks:<other-id> — mark as blocking another task

Status values: pending, in_progress, completed, deleted`,
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The task ID to update' },
      status: { type: 'string', description: 'New status: pending, in_progress, completed, deleted' },
      subject: { type: 'string', description: 'New subject' },
      description: { type: 'string', description: 'New description' },
      owner: { type: 'string', description: 'Agent name to assign' },
      addBlocks: { type: 'string', description: 'Task ID this blocks' },
      addBlockedBy: { type: 'string', description: 'Task ID blocking this' },
    },
    required: ['taskId'],
  },
  tier: 'write',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let taskId: string
      const updates: {
        status?: TaskStatus
        subject?: string
        description?: string
        owner?: string
        addBlocks?: string[]
        addBlockedBy?: string[]
      } = {}

      // Try JSON parse first
      try {
        const parsed = JSON.parse(args)
        taskId = parsed.taskId
        if (parsed.status) updates.status = parsed.status
        if (parsed.subject) updates.subject = parsed.subject
        if (parsed.description) updates.description = parsed.description
        if (parsed.owner) updates.owner = parsed.owner
        if (parsed.addBlocks) updates.addBlocks = [parsed.addBlocks]
        if (parsed.addBlockedBy) updates.addBlockedBy = [parsed.addBlockedBy]
      } catch {
        // Fall back to "key:value" format: "task-id status:completed"
        const parts = args.trim().split(/\s+/)
        taskId = parts[0] || ''
        for (const part of parts.slice(1)) {
          const [key, ...valueParts] = part.split(':')
          const value = valueParts.join(':')
          if (key === 'status') updates.status = value as TaskStatus
          else if (key === 'owner') updates.owner = value
          else if (key === 'addBlocks') updates.addBlocks = [value]
          else if (key === 'addBlockedBy') updates.addBlockedBy = [value]
          else if (key === 'subject') updates.subject = value
          else if (key === 'description') updates.description = value
        }
      }

      if (!taskId) return { output: 'Error: task ID is required', success: false }

      const task = updateTask(getTaskListId(), taskId, updates)
      if (!task) return { output: `Task not found: ${taskId}`, success: false }

      return {
        output: `Task #${task.id} updated: ${task.subject} [${task.status}]`,
        success: true,
        metadata: { taskId: task.id, status: task.status },
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
