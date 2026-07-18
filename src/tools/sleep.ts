/**
 * Kairo — Sleep Tool (Kairo-native rewrite)
 *
 * Sleep/delay tool for timing-sensitive operations.
 */

import type { ToolDefinition, ToolResult } from './types.js'

export const sleepTool: ToolDefinition = {
  name: 'sleep',
  description: 'Sleep for a specified duration (in milliseconds or human-readable format)',
  prompt: `Pause execution for a specified duration.

Usage:
- sleep <ms> — sleep for milliseconds
- sleep <duration> — sleep using human-readable format (e.g., "5s", "1m", "500ms")

Examples:
- sleep 1000 — sleep for 1 second
- sleep 5s — sleep for 5 seconds
- sleep 1m — sleep for 1 minute`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const input = args.trim()
      if (!input) return { output: 'Error: duration is required', success: false }

      let ms: number

      // Parse human-readable duration
      const match = input.match(/^(\d+)\s*(ms|s|m|h)?$/i)
      if (match) {
        const value = parseInt(match[1], 10)
        const unit = (match[2] || 'ms').toLowerCase()
        switch (unit) {
          case 'ms': ms = value; break
          case 's': ms = value * 1000; break
          case 'm': ms = value * 60 * 1000; break
          case 'h': ms = value * 60 * 60 * 1000; break
          default: ms = value
        }
      } else {
        ms = parseInt(input, 10)
      }

      if (isNaN(ms) || ms < 0) return { output: 'Error: invalid duration', success: false }
      if (ms > 300000) return { output: 'Error: max sleep is 5 minutes', success: false }

      await new Promise(resolve => setTimeout(resolve, ms))

      return { output: `Slept for ${ms}ms`, success: true, metadata: { duration: ms } }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
