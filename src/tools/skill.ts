/**
 * Kairo — Skill Tool (Kairo-native rewrite)
 *
 * Execute skills with context.
 */

import { existsSync, readFileSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import type { ToolDefinition, ToolResult } from './types.js'

const SKILLS_DIRS = [
  join(homedir(), '.kairo', 'skills'),
  join(homedir(), '.claude', 'skills'),
]

function findSkill(name: string): string | null {
  for (const dir of SKILLS_DIRS) {
    const path = join(dir, `${name}.md`)
    if (existsSync(path)) return path
  }
  return null
}

function loadSkill(path: string): { frontmatter: Record<string, string>; content: string } | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!match) return { frontmatter: {}, content: raw }

    const frontmatter: Record<string, string> = {}
    for (const line of match[1].split('\n')) {
      const [key, ...valueParts] = line.split(':')
      if (key && valueParts.length > 0) {
        frontmatter[key.trim()] = valueParts.join(':').trim()
      }
    }

    return { frontmatter, content: match[2].trim() }
  } catch {
    return null
  }
}

export const skillTool: ToolDefinition = {
  name: 'skill',
  description: 'Execute a skill by name — loads skill instructions and context',
  prompt: `Load and execute a skill from the skills directories.

Usage:
- skill <name> — load skill and show its instructions
- skill <name> <context> — load skill with additional context

Skills are markdown files in ~/.kairo/skills/ or ~/.claude/skills/ with frontmatter metadata.`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name' },
      context: { type: 'string', description: 'Additional context' },
    },
    required: ['name'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let name: string
      let context: string | undefined

      try {
        const parsed = JSON.parse(args)
        name = parsed.name
        context = parsed.context
      } catch {
        const parts = args.trim().split(/\s+/)
        name = parts[0] || ''
        context = parts.slice(1).join(' ')
      }

      if (!name) return { output: 'Error: skill name is required', success: false }

      const path = findSkill(name)
      if (!path) return { output: `Skill not found: ${name}`, success: false }

      const skill = loadSkill(path)
      if (!skill) return { output: `Failed to load skill: ${name}`, success: false }

      let output = skill.content
      if (context) {
        output += `\n\n---\nAdditional context:\n${context}`
      }

      return {
        output,
        success: true,
        metadata: { name, path, frontmatter: skill.frontmatter },
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
