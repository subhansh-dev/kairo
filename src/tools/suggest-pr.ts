/**
 * Kairo — SuggestBackgroundPR Tool (Kairo-native rewrite)
 *
 * Suggest creating a background PR for changes.
 */

import type { ToolDefinition, ToolResult } from './types.js'

export const suggestPRTool: ToolDefinition = {
  name: 'suggest_pr',
  description: 'Suggest creating a pull request for the current changes',
  prompt: `Suggest creating a background PR for the changes made.

Usage:
- suggest_pr — analyze changes and suggest PR
- suggest_pr <title> — suggest PR with specific title
- suggest_pr <base> <head> — suggest PR between branches`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const parts = args.trim().split(/\s+/)
      const title = parts[0] || ''
      const base = parts[1] || 'main'
      const head = parts[2] || 'HEAD'

      const lines = [
        'PR Suggestion:',
        '',
        'To create a PR, run:',
        `  gh pr create --base ${base} --head ${head}`,
      ]

      if (title) {
        lines.push(`  --title "${title}"`)
      }

      lines.push(
        '',
        'Or create a draft PR:',
        `  gh pr create --base ${base} --head ${head} --draft`,
      )

      return { output: lines.join('\n'), success: true, metadata: { base, head } }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
