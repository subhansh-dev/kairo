/**
 * Kairo — Memory Service (Kairo-native rewrite)
 *
 * Long-term memory storage and retrieval.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const MEMORY_DIR = join(homedir(), '.kairo', 'memory')

function ensureDir(): void {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true })
}

// ─── Types ───────────────────────────────────────────────────────

export type MemoryType = 'fact' | 'decision' | 'pattern' | 'preference' | 'error' | 'file' | 'context'

export interface Memory {
  id: string
  type: MemoryType
  content: string
  tags: string[]
  source?: string
  createdAt: string
  updatedAt: string
  accessCount: number
  lastAccessed?: string
}

// ─── Memory Storage ──────────────────────────────────────────────

function getMemoryPath(id: string): string {
  return join(MEMORY_DIR, `${id}.json`)
}

export function createMemory(type: MemoryType, content: string, tags: string[] = [], source?: string): Memory {
  ensureDir()
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const now = new Date().toISOString()
  const memory: Memory = {
    id,
    type,
    content,
    tags,
    source,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
  }
  writeFileSync(getMemoryPath(id), JSON.stringify(memory, null, 2))
  return memory
}

export function loadMemory(id: string): Memory | null {
  const path = getMemoryPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function saveMemory(memory: Memory): void {
  ensureDir()
  memory.updatedAt = new Date().toISOString()
  writeFileSync(getMemoryPath(memory.id), JSON.stringify(memory, null, 2))
}

export function listMemories(type?: MemoryType, tag?: string): Memory[] {
  ensureDir()
  const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json'))
  const memories: Memory[] = []

  for (const file of files) {
    try {
      const memory: Memory = JSON.parse(readFileSync(join(MEMORY_DIR, file), 'utf-8'))
      if (type && memory.type !== type) continue
      if (tag && !memory.tags.includes(tag)) continue
      memories.push(memory)
    } catch {
      // Skip corrupted files
    }
  }

  return memories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function deleteMemory(id: string): boolean {
  const path = getMemoryPath(id)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

export function searchMemories(query: string, limit: number = 10): Memory[] {
  const lowerQuery = query.toLowerCase()
  const allMemories = listMemories()

  const scored = allMemories.map(m => {
    let score = 0
    if (m.content.toLowerCase().includes(lowerQuery)) score += 10
    if (m.tags.some(t => t.toLowerCase().includes(lowerQuery))) score += 5
    if (m.type.toLowerCase().includes(lowerQuery)) score += 3
    return { memory: m, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => {
      s.memory.accessCount++
      s.memory.lastAccessed = new Date().toISOString()
      saveMemory(s.memory)
      return s.memory
    })
}

export function formatMemory(memory: Memory): string {
  const tags = memory.tags.length > 0 ? ` [${memory.tags.join(', ')}]` : ''
  return `[${memory.type}]${tags} ${memory.content}`
}

export function formatMemories(memories: Memory[]): string {
  if (memories.length === 0) return 'No memories found.'
  return memories.map(m => formatMemory(m)).join('\n')
}
