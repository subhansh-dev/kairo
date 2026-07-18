/**
 * Kairo — Agent Memory
 * Per-agent memory with snapshots for context preservation
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const MEMORY_DIR = join(homedir(), '.kairo', 'agent-memory')

function ensureDir(): void {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true })
}

export interface AgentMemoryEntry {
  key: string
  value: string
  timestamp: string
  agentName: string
}

export interface AgentMemorySnapshot {
  agentName: string
  entries: AgentMemoryEntry[]
  createdAt: string
}

/**
 * Save a memory entry for an agent
 */
export function saveMemory(agentName: string, key: string, value: string): void {
  ensureDir()
  const filePath = join(MEMORY_DIR, `${agentName}.json`)
  const entries: AgentMemoryEntry[] = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, 'utf-8'))
    : []

  const existing = entries.findIndex(e => e.key === key)
  const entry: AgentMemoryEntry = {
    key,
    value,
    timestamp: new Date().toISOString(),
    agentName,
  }

  if (existing >= 0) {
    entries[existing] = entry
  } else {
    entries.push(entry)
  }

  writeFileSync(filePath, JSON.stringify(entries, null, 2))
}

/**
 * Load all memory entries for an agent
 */
export function loadMemory(agentName: string): AgentMemoryEntry[] {
  const filePath = join(MEMORY_DIR, `${agentName}.json`)
  if (!existsSync(filePath)) return []
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
}

/**
 * Get a specific memory value by key
 */
export function getMemory(agentName: string, key: string): string | undefined {
  const entries = loadMemory(agentName)
  return entries.find(e => e.key === key)?.value
}

/**
 * Create a snapshot of current agent memory
 */
export function createSnapshot(agentName: string): AgentMemorySnapshot {
  return {
    agentName,
    entries: loadMemory(agentName),
    createdAt: new Date().toISOString(),
  }
}

/**
 * Restore agent memory from a snapshot
 */
export function restoreSnapshot(snapshot: AgentMemorySnapshot): void {
  ensureDir()
  const filePath = join(MEMORY_DIR, `${snapshot.agentName}.json`)
  writeFileSync(filePath, JSON.stringify(snapshot.entries, null, 2))
}

/**
 * Clear all memory for an agent
 */
export function clearMemory(agentName: string): void {
  const filePath = join(MEMORY_DIR, `${agentName}.json`)
  if (existsSync(filePath)) {
    writeFileSync(filePath, '[]')
  }
}

/**
 * Format memory as context string for injection into agent prompt
 */
export function formatMemoryContext(agentName: string): string {
  const entries = loadMemory(agentName)
  if (entries.length === 0) return ''
  return entries.map(e => `[${e.key}]: ${e.value}`).join('\n')
}
