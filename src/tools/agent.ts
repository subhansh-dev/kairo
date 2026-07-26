/**
 * Kairo — Agent Tool
 * Spawn sub-agents with isolation, memory, and workflow support
 */

import type { ToolDefinition, ToolResult } from './types.js'
import { runAgent, runWorkflow, listAgents, listWorkflows } from '../agents/orchestrator.js'
import { saveMemory, formatMemoryContext } from '../agents/memory.js'

export const agentTool: ToolDefinition = {
  name: 'agent',
  description: 'Spawn a sub-agent for specialized work (planner, coder, reviewer, security, tdd, explore)',
  prompt: `Spawn a specialized sub-agent for a task.

Usage:
- agent <agent-name> <task> — run a specific agent on a task
- agent workflow <workflow-name> <task> — run a multi-agent workflow
- agent list — list available agents
- agent workflows — list available workflows

Available agents: planner, coder, reviewer, security, tdd, explore
Available workflows: feature, bugfix, refactor, security, tdd, quick, plan, review, explore

Examples:
- agent planner "Plan the authentication system"
- agent coder "Implement the login endpoint"
- agent workflow feature "Add user profile editing"
- agent reviewer "Review src/auth.ts for bugs"`,
  parameters: {
    type: 'object',
    properties: {
      agentName: { type: 'string', description: 'Agent name or "workflow" or "list"' },
      task: { type: 'string', description: 'The task description' },
      model: { type: 'string', description: 'Override model for this agent' },
      context: { type: 'string', description: 'Additional context to provide' },
    },
    required: ['agentName', 'task'],
  },
  tier: 'exec',
  concurrencySafe: true,
  readOnly: false,
  destructive: false,

  execute: async (args: string, signal?: AbortSignal): Promise<ToolResult> => {
    try {
      let agentName: string
      let task: string
      let model: string | undefined
      let context: string | undefined

      // Try JSON parse first
      try {
        const parsed = JSON.parse(args)
        agentName = parsed.agentName
        task = parsed.task
        model = parsed.model
        context = parsed.context
      } catch {
        // Fall back to "agent-name task" format, respecting quotes
        const trimmed = args.trim()
        const firstSpace = trimmed.indexOf(' ')
        if (firstSpace === -1) {
          agentName = trimmed
          task = ''
        } else {
          agentName = trimmed.slice(0, firstSpace)
          task = trimmed.slice(firstSpace + 1).trim()
          // Strip surrounding quotes if present
          if ((task.startsWith('"') && task.endsWith('"')) || (task.startsWith("'") && task.endsWith("'"))) {
            task = task.slice(1, -1)
          }
        }
      }

      // List agents
      if (agentName === 'list' || agentName === 'agents') {
        const agents = listAgents()
        const lines = agents.map(a => `  ${a.name} — ${a.description}`)
        return { output: `Available agents:\n${lines.join('\n')}`, success: true }
      }

      // List workflows
      if (agentName === 'workflows' || agentName === 'workflow-list') {
        const workflows = listWorkflows()
        const lines = Object.entries(workflows).map(([name, steps]) => `  ${name} → ${steps.join(' → ')}`)
        return { output: `Available workflows:\n${lines.join('\n')}`, success: true }
      }

      // Run workflow
      if (agentName === 'workflow') {
        const workflowParts = task.split(/\s+/)
        const workflowName = workflowParts[0] || ''
        const workflowTask = workflowParts.slice(1).join(' ')

        if (!workflowName) return { output: 'Error: workflow name is required', success: false }
        if (!workflowTask) return { output: 'Error: task is required', success: false }

        signal?.throwIfAborted()
        const result = await runWorkflow(workflowName, workflowTask, { model, context, signal })

        const summary = result.steps.map(s =>
          `[${s.agent}] ${s.output.slice(0, 200)}${s.output.length > 200 ? '...' : ''}`
        ).join('\n\n')

        return {
          output: `Workflow "${workflowName}" completed (${result.steps.length} steps):\n\n${summary}`,
          success: true,
          metadata: { workflow: workflowName, steps: result.steps.length },
        }
      }

      // Run single agent
      if (!agentName) return { output: 'Error: agent name is required', success: false }
      if (!task) return { output: 'Error: task is required', success: false }

      // Inject agent memory into context
      const memoryContext = formatMemoryContext(agentName)
      const fullContext = [context, memoryContext].filter(Boolean).join('\n\n')

      signal?.throwIfAborted()
      const result = await runAgent(agentName, task, { model, context: fullContext, signal })

      // Save key findings to agent memory
      if (result.output.length > 0) {
        saveMemory(agentName, `last-task-${Date.now()}`, result.output.slice(0, 500))
      }

      return {
        output: result.output,
        success: true,
        metadata: {
          agent: result.agent,
          turns: result.turns,
          toolCalls: result.toolCalls.length,
          route: result.route,
        },
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return { output: 'Agent cancelled.', success: false }
      return { output: `Agent error: ${e.message}`, success: false }
    }
  },
}
