/**
 * Kairo — TaskCreate Tool
 * Adapted to kairo's ToolDefinition interface
 */

import type { ToolDefinition, ToolResult } from './types.js'
import { createTask, getTaskListId } from '../tasks/index.js'

export const taskCreateTool: ToolDefinition = {
  name: 'task_create',
  description: 'Create a new task in the task list',
  prompt: `Create a structured task for tracking progress on multi-step work.

Usage:
- task_create <subject> | <description> — create a task with subject and description
- subject: brief title (imperative form, e.g., "Fix auth bug")
- description: detailed requirements

Tasks help track progress across turns. Use for complex multi-step work.`,
  parameters: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'A brief title for the task' },
      description: { type: 'string', description: 'What needs to be done' },
      activeForm: { type: 'string', description: 'Present continuous form shown when in_progress (e.g., "Running tests")' },
    },
    required: ['subject', 'description'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let subject: string
      let description: string
      let activeForm: string | undefined

      // Try JSON parse first
      try {
        const parsed = JSON.parse(args)
        subject = parsed.subject
        description = parsed.description
        activeForm = parsed.activeForm
      } catch {
        // Fall back to pipe-delimited: "subject | description"
        const parts = args.split('|').map(s => s.trim())
        subject = parts[0] || ''
        description = parts[1] || ''
      }

      if (!subject) return { output: 'Error: subject is required', success: false }
      if (!description) return { output: 'Error: description is required', success: false }

      const taskId = createTask(getTaskListId(), { subject, description, activeForm })
      return {
        output: `Task #${taskId} created successfully: ${subject}`,
        success: true,
        metadata: { taskId, subject },
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
