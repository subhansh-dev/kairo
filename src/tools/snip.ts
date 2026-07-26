/**
 * Kairo — Snip Tool (Kairo-native rewrite)
 *
 * Snip/trim conversation history to free up context.
 */

import type { ToolDefinition, ToolResult } from './types.js'

export const snipTool: ToolDefinition = {
  name: 'snip',
  description: 'Snip/trim conversation history to free up context space',
  prompt: `Remove messages from conversation history to free up context.

Usage:
- snip last <n> — remove last N messages
- snip range <start> <end> — remove messages in range
- snip tool-outputs — remove all tool outputs
- snip old — remove old messages (keep recent 10)`,
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', description: 'last, range, tool-outputs, or old' },
      count: { type: 'number', description: 'Number of messages (for "last" mode)' },
      start: { type: 'number', description: 'Start index (for "range" mode)' },
      end: { type: 'number', description: 'End index (for "range" mode)' },
    },
    required: ['mode'],
  },
  tier: 'write',
  concurrencySafe: false,
  readOnly: false,
  destructive: true,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let mode: string
      let count: number | undefined
      let start: number | undefined
      let end: number | undefined

      try {
        const parsed = JSON.parse(args)
        mode = parsed.mode
        count = parsed.count
        start = parsed.start
        end = parsed.end
      } catch {
        const parts = args.trim().split(/\s+/)
        mode = parts[0] || ''
        count = parseInt(parts[1] || '0', 10)
        start = parseInt(parts[1] || '0', 10)
        end = parseInt(parts[2] || '0', 10)
      }

      // This would need access to the actual message store
      // For now, return a placeholder
      switch (mode) {
        case 'last':
          return { output: `Would remove last ${count} messages`, success: true, metadata: { mode, count } }
        case 'range':
          return { output: `Would remove messages ${start}-${end}`, success: true, metadata: { mode, start, end } }
        case 'tool-outputs':
          return { output: 'Would remove all tool outputs', success: true, metadata: { mode } }
        case 'old':
          return { output: 'Would remove old messages (keep recent 10)', success: true, metadata: { mode } }
        default:
          return { output: 'Usage: snip last|range|tool-outputs|old', success: false }
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
