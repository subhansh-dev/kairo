/**
 * Kairo — Goal Tool (Kairo-native rewrite)
 *
 * Track progress toward long-running goals.
 */

import type { ToolDefinition, ToolResult } from './types.js'
import {
  createGoal,
  loadGoal,
  listGoals,
  updateGoalStatus,
  addMilestone,
  completeMilestone,
  formatGoal,
} from '../services/goal/tracker.js'

export const goalTool: ToolDefinition = {
  name: 'goal',
  description: 'Track progress toward long-running goals with milestones',
  prompt: `Manage goals and milestones for tracking long-running work.

Usage:
- goal create <title> | <description> — create a new goal
- goal list — list all active goals
- goal show <id> — show goal details
- goal complete <id> — mark goal as completed
- goal milestone <id> <title> — add a milestone
- goal done <goal-id> <milestone-id> — complete a milestone`,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'create, list, show, complete, milestone, done' },
      goalId: { type: 'string', description: 'Goal ID' },
      title: { type: 'string', description: 'Goal or milestone title' },
      description: { type: 'string', description: 'Goal description' },
      milestoneId: { type: 'string', description: 'Milestone ID' },
    },
    required: ['action'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let action: string
      let goalId: string | undefined
      let title: string | undefined
      let description: string | undefined
      let milestoneId: string | undefined

      // Try JSON parse first
      try {
        const parsed = JSON.parse(args)
        action = parsed.action
        goalId = parsed.goalId
        title = parsed.title
        description = parsed.description
        milestoneId = parsed.milestoneId
      } catch {
        // Fall back to "action args" format
        const parts = args.trim().split(/\s+/)
        action = parts[0] || ''
        goalId = parts[1]
        title = parts.slice(2).join(' ')
      }

      switch (action) {
        case 'create': {
          if (!title) return { output: 'Error: title is required', success: false }
          const desc = description || ''
          const goal = createGoal(title, desc)
          return { output: `Goal created: ${goal.id}\n${formatGoal(goal)}`, success: true }
        }

        case 'list': {
          const goals = listGoals()
          if (goals.length === 0) return { output: 'No goals.', success: true }
          const output = goals.map(g => formatGoal(g)).join('\n\n')
          return { output, success: true }
        }

        case 'show': {
          if (!goalId) return { output: 'Error: goal ID is required', success: false }
          const goal = loadGoal(goalId)
          if (!goal) return { output: `Goal not found: ${goalId}`, success: false }
          return { output: formatGoal(goal), success: true }
        }

        case 'complete': {
          if (!goalId) return { output: 'Error: goal ID is required', success: false }
          const goal = updateGoalStatus(goalId, 'completed')
          if (!goal) return { output: `Goal not found: ${goalId}`, success: false }
          return { output: `Goal completed: ${goal.title}`, success: true }
        }

        case 'milestone': {
          if (!goalId || !title) return { output: 'Error: goal ID and title are required', success: false }
          const milestone = addMilestone(goalId, title)
          if (!milestone) return { output: `Goal not found: ${goalId}`, success: false }
          return { output: `Milestone added: ${milestone.title}`, success: true }
        }

        case 'done': {
          if (!goalId || !milestoneId) return { output: 'Error: goal ID and milestone ID are required', success: false }
          const success = completeMilestone(goalId, milestoneId)
          if (!success) return { output: 'Goal or milestone not found', success: false }
          return { output: 'Milestone completed!', success: true }
        }

        default:
          return { output: 'Usage: goal create|list|show|complete|milestone|done', success: false }
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
