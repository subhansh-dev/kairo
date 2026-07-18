/**
 * Kairo — ToolSearch Tool (Kairo-native rewrite)
 *
 * Search available tools by keyword for deferred loading.
 */

import type { ToolDefinition, ToolResult, ToolRegistry } from './types.js'

export function createToolSearchTool(registry: ToolRegistry): ToolDefinition {
  return {
    name: 'tool_search',
    description: 'Search available tools by keyword. Use when you need a tool but don\'t know its exact name.',
    prompt: `Search for tools by keyword or category.

Usage:
- tool_search <keyword> — find tools matching the keyword
- tool_search --all — list all available tools

Examples:
- tool_search file — find file-related tools
- tool_search git — find git-related tools
- tool_search search — find search-related tools`,
    tier: 'read',
    concurrencySafe: true,
    readOnly: true,
    destructive: false,

    execute: async (args: string): Promise<ToolResult> => {
      try {
        const query = args.trim().toLowerCase()

        if (query === '--all') {
          const tools = registry.getAll()
          const output = tools.map(t => `  ${t.name} — ${t.description}`).join('\n')
          return { output: `All tools (${tools.length}):\n${output}`, success: true }
        }

        if (!query) {
          return { output: 'Usage: tool_search <keyword>', success: false }
        }

        const tools = registry.getAll().filter(t =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query)
        )

        if (tools.length === 0) {
          return { output: `No tools matching "${query}"`, success: true }
        }

        const output = tools.map(t => {
          const safety = t.readOnly ? ' [read-only]' : t.destructive ? ' [destructive]' : ''
          return `  ${t.name} — ${t.description}${safety}`
        }).join('\n')

        return {
          output: `Tools matching "${query}" (${tools.length}):\n${output}`,
          success: true,
          metadata: { count: tools.length, query },
        }
      } catch (e) {
        return { output: `Error: ${(e as Error).message}`, success: false }
      }
    },
  }
}
