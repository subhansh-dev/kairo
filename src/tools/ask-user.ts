/**
 * Kairo — AskUserQuestion Tool (Kairo-native rewrite)
 *
 * Ask the user a question with multiple choice options.
 */

import type { ToolDefinition, ToolResult } from './types.js'

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description: 'Ask the user a question with optional multiple choice options',
  prompt: `Ask the user a question to clarify requirements or get input.

Usage:
- ask_user <question> — ask a free-form question
- ask_user <question> | option1, option2, option3 — ask with choices

Examples:
- ask_user "Which database should we use?"
- ask_user "What's the priority?" | "high", "medium", "low"`,
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask' },
      options: { type: 'string', description: 'Comma-separated list of options' },
    },
    required: ['question'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let question: string
      let options: string[] = []

      // Try JSON parse first
      try {
        const parsed = JSON.parse(args)
        question = parsed.question
        if (parsed.options) {
          options = Array.isArray(parsed.options) ? parsed.options : parsed.options.split(',').map((s: string) => s.trim())
        }
      } catch {
        // Fall back to "question | option1, option2" format
        const parts = args.split('|')
        question = parts[0]?.trim() || ''
        if (parts[1]) {
          options = parts[1].split(',').map(s => s.trim()).filter(Boolean)
        }
      }

      if (!question) return { output: 'Error: question is required', success: false }

      let output = question
      if (options.length > 0) {
        output += '\n\n' + options.map((o, i) => `  ${i + 1}. ${o}`).join('\n')
      }

      return { output, success: true, metadata: { question, options } }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
