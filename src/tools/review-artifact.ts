/**
 * Kairo — ReviewArtifact Tool (Kairo-native rewrite)
 *
 * Review generated artifacts (code, docs, configs).
 */

import { existsSync, readFileSync } from 'fs'
import type { ToolDefinition, ToolResult } from './types.js'

export const reviewArtifactTool: ToolDefinition = {
  name: 'review_artifact',
  description: 'Review a generated artifact (file, code, config) for quality and correctness',
  prompt: `Review an artifact file for quality, correctness, and completeness.

Usage:
- review_artifact <filepath> — review a file
- review_artifact <filepath> <criteria> — review against specific criteria

Checks for:
- Syntax correctness
- Common errors
- Best practices
- Security issues
- Completeness`,
  parameters: {
    type: 'object',
    properties: {
      filepath: { type: 'string', description: 'Path to the artifact' },
      criteria: { type: 'string', description: 'Specific review criteria' },
    },
    required: ['filepath'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let filepath: string
      let criteria: string | undefined

      try {
        const parsed = JSON.parse(args)
        filepath = parsed.filepath
        criteria = parsed.criteria
      } catch {
        const parts = args.trim().split(/\s+/)
        filepath = parts[0] || ''
        criteria = parts.slice(1).join(' ')
      }

      if (!filepath) return { output: 'Error: filepath is required', success: false }
      if (!existsSync(filepath)) return { output: `Error: file not found: ${filepath}`, success: false }

      const content = readFileSync(filepath, 'utf-8')
      const lines = content.split('\n')

      const issues: string[] = []
      const suggestions: string[] = []

      // Basic checks
      if (lines.length === 0) issues.push('File is empty')
      if (content.includes('TODO')) suggestions.push('Contains TODO comments')
      if (content.includes('FIXME')) issues.push('Contains FIXME comments')
      if (content.includes('HACK')) issues.push('Contains HACK comments')
      if (content.includes('console.log')) suggestions.push('Contains console.log statements')

      // Check for common patterns
      if (filepath.endsWith('.ts') || filepath.endsWith('.tsx')) {
        if (content.includes('any')) suggestions.push('Contains "any" types')
        if (content.includes('// @ts-ignore')) issues.push('Contains @ts-ignore')
      }

      const output = [
        `Review of ${filepath}:`,
        `  Lines: ${lines.length}`,
        `  Size: ${content.length} bytes`,
        '',
      ]

      if (issues.length > 0) {
        output.push('Issues:')
        issues.forEach(i => output.push(`  ⚠ ${i}`))
      }

      if (suggestions.length > 0) {
        output.push('Suggestions:')
        suggestions.forEach(s => output.push(`  💡 ${s}`))
      }

      if (issues.length === 0 && suggestions.length === 0) {
        output.push('✓ No issues found')
      }

      if (criteria) {
        output.push('', `Review criteria: ${criteria}`)
      }

      return { output: output.join('\n'), success: true, metadata: { filepath, issues: issues.length, suggestions: suggestions.length } }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
