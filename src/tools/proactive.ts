/**
 * Kairo — Proactive Tool (Kairo-native rewrite)
 *
 * Proactively suggest actions based on context.
 */

import type { ToolDefinition, ToolResult } from './types.js'

export const proactiveTool: ToolDefinition = {
  name: 'proactive',
  description: 'Get proactive suggestions based on current context and project state',
  prompt: `Get proactive suggestions for what to do next.

Usage:
- proactive — analyze context and suggest next steps
- proactive <area> — focus suggestions on specific area (code, tests, docs, security)

Suggestions are based on:
- Recent conversation context
- Project state (git, files, tests)
- Common patterns and best practices`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const area = args.trim() || 'general'

      const suggestions: string[] = []

      switch (area) {
        case 'code':
          suggestions.push(
            'Review recently modified files for issues',
            'Check for TypeScript errors',
            'Run linter on changed files',
            'Update tests for new code',
          )
          break

        case 'tests':
          suggestions.push(
            'Run existing test suite',
            'Check test coverage',
            'Add tests for untested code',
            'Fix failing tests',
          )
          break

        case 'docs':
          suggestions.push(
            'Update README with recent changes',
            'Add JSDoc comments to new functions',
            'Document API endpoints',
            'Create usage examples',
          )
          break

        case 'security':
          suggestions.push(
            'Check for hardcoded secrets',
            'Review authentication flow',
            'Validate user inputs',
            'Check dependency vulnerabilities',
          )
          break

        default:
          suggestions.push(
            'Review recent changes',
            'Run tests',
            'Check for errors',
            'Update documentation',
            'Consider refactoring opportunities',
          )
      }

      return {
        output: `Proactive suggestions (${area}):\n${suggestions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`,
        success: true,
        metadata: { area, count: suggestions.length },
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
