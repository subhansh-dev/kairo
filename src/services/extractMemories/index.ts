/**
 * Kairo — Memory Extraction (Kairo-native rewrite)
 *
 * Extract key facts and decisions from conversations for long-term memory.
 */

import type { ChatMessage } from '../../providers/registry.js'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export interface ExtractedMemory {
  type: 'decision' | 'file' | 'error' | 'pattern' | 'preference' | 'fact'
  content: string
  source: string // Which message triggered this
  confidence: number // 0-1
  timestamp: string
}

/**
 * Extract memories from a conversation
 */
export function extractMemories(messages: ChatMessage[]): ExtractedMemory[] {
  const memories: ExtractedMemory[] = []

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const content = typeof msg.content === 'string' ? msg.content : ''

    // Extract decisions
    const decisionPatterns = [
      /(?:decided|chose|picked|going with|using|selected)\s+(.{20,100})/gi,
      /(?:let's|we'll|I'll)\s+(?:use|go with|implement|choose)\s+(.{20,100})/gi,
    ]
    for (const pattern of decisionPatterns) {
      let match
      while ((match = pattern.exec(content))) {
        memories.push({
          type: 'decision',
          content: match[1].trim(),
          source: content.slice(0, 100),
          confidence: 0.8,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // Extract file operations
    const filePatterns = [
      /(?:created|modified|wrote|edited|fixed|updated)\s+(?:file\s+)?[`"']?([\/\w.-]+\.\w+)[`"']?/gi,
      /(?:in|at|from)\s+(?:file\s+)?[`"']?([\/\w.-]+\.\w+)[`"']?:?\s*(?:line\s+(\d+))?/gi,
    ]
    for (const pattern of filePatterns) {
      let match
      while ((match = pattern.exec(content))) {
        memories.push({
          type: 'file',
          content: match[1],
          source: content.slice(0, 100),
          confidence: 0.9,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // Extract errors
    const errorPatterns = [
      /(?:error|bug|issue|problem|failure)[:\s]+(.{20,150})/gi,
      /(?:failed|crashed|broke|threw)\s+(?:with|because|due to)\s+(.{20,100})/gi,
    ]
    for (const pattern of errorPatterns) {
      let match
      while ((match = pattern.exec(content))) {
        memories.push({
          type: 'error',
          content: match[1].trim(),
          source: content.slice(0, 100),
          confidence: 0.7,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // Extract patterns
    const patternMatches = [
      /(?:pattern|convention|standard|practice)\s+(?:is|should be|follows)\s+(.{20,100})/gi,
      /(?:always|never|don't|avoid)\s+(.{20,80})/gi,
    ]
    for (const pattern of patternMatches) {
      let match
      while ((match = pattern.exec(content))) {
        memories.push({
          type: 'pattern',
          content: match[1].trim(),
          source: content.slice(0, 100),
          confidence: 0.6,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // Extract preferences
    const preferencePatterns = [
      /(?:prefer|like|want|need)\s+(.{20,80})/gi,
      /(?:should|must|important to)\s+(.{20,80})/gi,
    ]
    for (const pattern of preferencePatterns) {
      let match
      while ((match = pattern.exec(content))) {
        memories.push({
          type: 'preference',
          content: match[1].trim(),
          source: content.slice(0, 100),
          confidence: 0.5,
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  return memories.filter(m => {
    const key = `${m.type}:${m.content}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Format memories for display
 */
export function formatMemories(memories: ExtractedMemory[]): string {
  if (memories.length === 0) return 'No memories extracted.'

  const byType = new Map<string, ExtractedMemory[]>()
  for (const m of memories) {
    if (!byType.has(m.type)) byType.set(m.type, [])
    byType.get(m.type)!.push(m)
  }

  const lines: string[] = []
  for (const [type, items] of byType) {
    lines.push(`\n${type.charAt(0).toUpperCase() + type.slice(1)}s:`)
    for (const item of items) {
      lines.push(`  - ${item.content}`)
    }
  }

  return lines.join('\n')
}

/**
 * Save memories to a file
 */
export function saveMemories(memories: ExtractedMemory[], filepath: string): void {
  const dir = dirname(filepath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filepath, JSON.stringify(memories, null, 2))
}

/**
 * Load memories from a file
 */
export function loadMemories(filepath: string): ExtractedMemory[] {
  if (!existsSync(filepath)) return []
  try {
    return JSON.parse(readFileSync(filepath, 'utf-8'))
  } catch {
    return []
  }
}
