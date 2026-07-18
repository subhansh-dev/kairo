/**
 * Kairo — TaskList Tool
 */

import type { ToolDefinition, ToolResult } from './types.js'
import { listTasks, getTaskListId } from '../tasks/index.js'

export const taskListTool: ToolDefinition = {
  name: 'task_list',
  description: 'List all tasks with optional status filter',
  prompt: `List tasks in the task list.

Usage:
- task_list — list all tasks
- task_list pending — list only pending tasks
- task_list completed — list only completed tasks
- task_list in_progress — list only in-progress tasks`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const filter = args.trim() ? { status: args.trim() as 'pending' | 'in_progress' | 'completed' | 'deleted' } : undefined
      const tasks = listTasks(getTaskListId(), filter)
      if (tasks.length === 0) return { output: 'No tasks.', success: true }

      const pending = tasks.filter(t => t.status === 'pending')
      const inProgress = tasks.filter(t => t.status === 'in_progress')
      const completed = tasks.filter(t => t.status === 'completed')

      let out = ''
      if (pending.length > 0) {
        out += 'Pending:\n' + pending.map(t => `  [ ] ${t.id} — ${t.subject}`).join('\n')
      }
      if (inProgress.length > 0) {
        if (out) out += '\n'
        out += 'In Progress:\n' + inProgress.map(t => `  [~] ${t.id} — ${t.subject}${t.activeForm ? ` (${t.activeForm})` : ''}`).join('\n')
      }
      if (completed.length > 0) {
        if (out) out += '\n'
        out += 'Completed:\n' + completed.map(t => `  [x] ${t.id} — ${t.subject}`).join('\n')
      }
      return { output: out, success: true }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
