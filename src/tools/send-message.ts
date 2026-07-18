/**
 * Kairo — SendMessage Tool (Kairo-native rewrite)
 *
 * Send messages to sub-agents or teammates in multi-agent workflows.
 */

import type { ToolDefinition, ToolResult } from './types.js'

// In-memory message queue for agent communication
const messageQueues = new Map<string, Array<{ from: string; message: string; timestamp: number }>>()

export const sendMessageTool: ToolDefinition = {
  name: 'send_message',
  description: 'Send a message to a sub-agent or teammate',
  prompt: `Send a message to another agent in a multi-agent workflow.

Usage:
- send_message <agent-name> <message> — send a message to an agent
- send_message broadcast <message> — send to all agents

Messages are queued and delivered when the target agent runs.`,
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Target agent name or "broadcast"' },
      message: { type: 'string', description: 'The message to send' },
    },
    required: ['target', 'message'],
  },
  tier: 'write',
  concurrencySafe: true,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let target: string
      let message: string

      // Try JSON parse first
      try {
        const parsed = JSON.parse(args)
        target = parsed.target
        message = parsed.message
      } catch {
        // Fall back to "target message" format
        const parts = args.trim().split(/\s+/)
        target = parts[0] || ''
        message = parts.slice(1).join(' ')
      }

      if (!target) return { output: 'Error: target agent name is required', success: false }
      if (!message) return { output: 'Error: message is required', success: false }

      const entry = { from: 'main', message, timestamp: Date.now() }

      if (target === 'broadcast') {
        // Send to all queues
        for (const queue of messageQueues.values()) {
          queue.push(entry)
        }
        return { output: `Message broadcast to all agents`, success: true }
      }

      // Send to specific agent
      if (!messageQueues.has(target)) {
        messageQueues.set(target, [])
      }
      messageQueues.get(target)!.push(entry)

      return { output: `Message sent to ${target}`, success: true }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}

// ─── Message Queue API ───────────────────────────────────────────

/**
 * Get pending messages for an agent
 */
export function getMessages(agentName: string): Array<{ from: string; message: string; timestamp: number }> {
  const messages = messageQueues.get(agentName) || []
  messageQueues.set(agentName, []) // Clear after reading
  return messages
}

/**
 * Check if an agent has pending messages
 */
export function hasMessages(agentName: string): boolean {
  return (messageQueues.get(agentName)?.length || 0) > 0
}

/**
 * Clear all message queues
 */
export function clearAllMessages(): void {
  messageQueues.clear()
}
