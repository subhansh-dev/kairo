/**
 * Kairo — DiscoverSkills Tool (Kairo-native rewrite)
 *
 * Discover available skills dynamically.
 */

import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import type { ToolDefinition, ToolResult } from './types.js'

const SKILLS_DIRS = [
  join(homedir(), '.kairo', 'skills'),
  join(homedir(), '.claude', 'skills'),
]

interface SkillInfo {
  name: string
  description: string
  path: string
}

function discoverSkills(): SkillInfo[] {
  const skills: SkillInfo[] = []

  for (const dir of SKILLS_DIRS) {
    if (!existsSync(dir)) continue

    const files = readdirSync(dir).filter(f => extname(f) === '.md')
    for (const file of files) {
      const path = join(dir, file)
      try {
        const content = readFileSync(path, 'utf-8')
        const nameMatch = content.match(/^name:\s*(.+)$/m)
        const descMatch = content.match(/^description:\s*(.+)$/m)
        skills.push({
          name: nameMatch?.[1]?.trim() || file.replace(/\.md$/, ''),
          description: descMatch?.[1]?.trim() || 'No description',
          path,
        })
      } catch {
        // Skip unreadable files
      }
    }
  }

  return skills
}

export const discoverSkillsTool: ToolDefinition = {
  name: 'discover_skills',
  description: 'Discover available skills in the skills directories',
  prompt: `List all available skills from ~/.kairo/skills/ and ~/.claude/skills/.

Usage:
- discover_skills — list all available skills
- discover_skills <query> — search skills by name or description`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const query = args.trim().toLowerCase()
      let skills = discoverSkills()

      if (query) {
        skills = skills.filter(s =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query)
        )
      }

      if (skills.length === 0) {
        return { output: query ? `No skills matching "${query}"` : 'No skills found', success: true }
      }

      const output = skills.map(s => `  ${s.name} — ${s.description}`).join('\n')
      return { output: `Available skills:\n${output}`, success: true, metadata: { count: skills.length } }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
