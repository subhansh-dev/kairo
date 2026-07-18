/**
 * Kairo — Advisor Tool (Kairo-native rewrite)
 *
 * Get expert advice on code, architecture, and best practices.
 */

import type { ToolDefinition, ToolResult } from './types.js'

export const advisorTool: ToolDefinition = {
  name: 'advisor',
  description: 'Get expert advice on code, architecture, security, or best practices',
  prompt: `Get expert advice on a topic or code.

Usage:
- advisor <topic> — get advice on a topic
- advisor <topic> <code> — get advice on specific code

Topics:
- architecture — system design advice
- security — security best practices
- performance — optimization tips
- testing — testing strategies
- refactoring — code improvement suggestions
- patterns — design patterns`,
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic to get advice on' },
      code: { type: 'string', description: 'Code to review' },
    },
    required: ['topic'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let topic: string
      let code: string | undefined

      try {
        const parsed = JSON.parse(args)
        topic = parsed.topic
        code = parsed.code
      } catch {
        const parts = args.trim().split(/\s+/)
        topic = parts[0] || ''
        code = parts.slice(1).join(' ')
      }

      const advice: Record<string, string[]> = {
        architecture: [
          'Keep modules small and focused (single responsibility)',
          'Use dependency injection for testability',
          'Define clear interfaces between components',
          'Prefer composition over inheritance',
          'Use events for loose coupling',
        ],
        security: [
          'Validate all user inputs',
          'Use parameterized queries for database access',
          'Hash passwords with bcrypt/argon2',
          'Implement proper authentication and authorization',
          'Keep dependencies updated',
          'Use HTTPS everywhere',
          'Implement rate limiting',
        ],
        performance: [
          'Profile before optimizing',
          'Use caching for expensive operations',
          'Minimize database queries (N+1 problem)',
          'Use lazy loading for large resources',
          'Consider pagination for large datasets',
        ],
        testing: [
          'Write tests before code (TDD)',
          'Test edge cases and error paths',
          'Use mocks for external dependencies',
          'Keep tests fast and focused',
          'Aim for 80%+ code coverage',
        ],
        refactoring: [
          'Extract methods when functions get too long',
          'Remove code duplication',
          'Simplify conditional logic',
          'Use meaningful names',
          'Add types to untyped code',
        ],
        patterns: [
          'Repository pattern for data access',
          'Factory pattern for object creation',
          'Observer pattern for event handling',
          'Strategy pattern for swappable algorithms',
          'Decorator pattern for extending behavior',
        ],
      }

      const topicAdvice = advice[topic] || advice['architecture']

      let output = `Advice on ${topic}:\n${topicAdvice.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}`

      if (code) {
        output += `\n\nCode context:\n${code.slice(0, 500)}`
      }

      return { output, success: true, metadata: { topic } }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
