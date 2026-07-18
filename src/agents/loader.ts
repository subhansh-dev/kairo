/**
 * Kairo — Agent Loader
 * Load agent definitions from ~/.kairo/agents/ directory
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import type { AgentDef } from './orchestrator.js';
import { AGENTS } from './orchestrator.js';

const AGENTS_DIR = join(homedir(), '.kairo', 'agents')

/**
 * Parse a markdown agent definition file
 * Format:
 *   ---
 *   name: my-agent
 *   description: Does something
 *   model: nvidia/nemotron-3-ultra-550b-a55b
 *   maxTurns: 5
 *   enableTools: true
 *   ---
 *   System prompt content here...
 */
function parseAgentFile(content: string): AgentDef | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!frontmatterMatch) return null

  const [, frontmatter, systemPrompt] = frontmatterMatch
  const meta: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const [key, ...valueParts] = line.split(':')
    if (key && valueParts.length > 0) {
      meta[key.trim()] = valueParts.join(':').trim()
    }
  }

  if (!meta.name) return null

  return {
    name: meta.name,
    description: meta.description || `Custom agent: ${meta.name}`,
    systemPrompt: systemPrompt.trim(),
    enableTools: meta.enableTools !== 'false',
    maxTurns: parseInt(meta.maxTurns || '5', 10),
    preferredModel: meta.model,
  }
}

/**
 * Load all agent definitions from ~/.kairo/agents/
 */
export function loadAgentsFromDir(): Record<string, AgentDef> {
  const agents: Record<string, AgentDef> = {}
  if (!existsSync(AGENTS_DIR)) return agents

  const files = readdirSync(AGENTS_DIR).filter(f =>
    extname(f) === '.md' || extname(f) === '.json'
  )

  for (const file of files) {
    const content = readFileSync(join(AGENTS_DIR, file), 'utf-8')
    let agent: AgentDef | null = null

    if (file.endsWith('.md')) {
      agent = parseAgentFile(content)
    } else if (file.endsWith('.json')) {
      try {
        const parsed = JSON.parse(content)
        if (parsed.name && parsed.systemPrompt) {
          agent = {
            name: parsed.name,
            description: parsed.description || `Custom agent: ${parsed.name}`,
            systemPrompt: parsed.systemPrompt,
            enableTools: parsed.enableTools !== false,
            maxTurns: parsed.maxTurns || 5,
            preferredModel: parsed.model,
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }

    if (agent) agents[agent.name] = agent
  }

  return agents
}

/**
 * Get merged agents: built-in + directory-loaded
 */
export function getAllAgents(): Record<string, AgentDef> {
  const dirAgents = loadAgentsFromDir()
  return { ...AGENTS, ...dirAgents }
}
