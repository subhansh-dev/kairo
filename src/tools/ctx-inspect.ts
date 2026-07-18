/**
 * Kairo — CtxInspect Tool (Kairo-native rewrite)
 *
 * Inspect current context state — messages, tokens, pressure.
 */

import type { ToolDefinition, ToolResult } from './types.js'

export const ctxInspectTool: ToolDefinition = {
  name: 'ctx_inspect',
  description: 'Inspect current context state — message count, token usage, pressure',
  prompt: `Inspect the current conversation context.

Usage:
- ctx_inspect — show context stats
- ctx_inspect messages — show message breakdown
- ctx_inspect tokens — show token usage`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const mode = args.trim() || 'all'

      // This would need access to the actual message store
      // For now, return a placeholder that shows the concept
      const lines = [
        'Context Inspection:',
        '  Messages: [count from session]',
        '  Tokens: [estimated from session]',
        '  Pressure: [0-1 from compact manager]',
        '  Model: [current model]',
        '',
        'Use this to understand context window usage before compaction.',
      ]

      return { output: lines.join('\n'), success: true }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
