/**
 * Kairo — Wiki System (Kairo-native rewrite)
 *
 * Build and search a wiki index from project documentation.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

// ─── Types ───────────────────────────────────────────────────────

export interface WikiPage {
  path: string
  title: string
  content: string
  headings: string[]
  links: string[]
  lastModified: string
}

export interface WikiIndex {
  pages: Map<string, WikiPage>
  searchIndex: Map<string, Set<string>> // word → page paths
}

// ─── Wiki Builder ────────────────────────────────────────────────

const DOC_EXTENSIONS = ['.md', '.txt', '.rst', '.adoc']

function extractHeadings(content: string): string[] {
  const headings: string[] = []
  const pattern = /^#{1,6}\s+(.+)$/gm
  let match
  while ((match = pattern.exec(content))) {
    headings.push(match[1].trim())
  }
  return headings
}

function extractLinks(content: string): string[] {
  const links: string[] = []
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g
  let match
  while ((match = pattern.exec(content))) {
    links.push(match[2])
  }
  return links
}

function extractTitle(content: string, filepath: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()
  return filepath.split('/').pop()?.replace(/\.\w+$/, '') || 'Untitled'
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
}

/**
 * Build wiki index from a directory
 */
export function buildWikiIndex(rootDir: string, maxDepth: number = 3): WikiIndex {
  const pages = new Map<string, WikiPage>()
  const searchIndex = new Map<string, Set<string>>()

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return

    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        const path = join(dir, entry)
        const stat = statSync(path)

        if (stat.isDirectory()) {
          // Skip node_modules, .git, etc.
          if (!entry.startsWith('.') && entry !== 'node_modules') {
            walk(path, depth + 1)
          }
          continue
        }

        if (!DOC_EXTENSIONS.includes(extname(entry))) continue

        try {
          const content = readFileSync(path, 'utf-8')
          const page: WikiPage = {
            path,
            title: extractTitle(content, path),
            content,
            headings: extractHeadings(content),
            links: extractLinks(content),
            lastModified: stat.mtime.toISOString(),
          }

          pages.set(path, page)

          // Build search index
          const tokens = tokenize(content)
          for (const token of tokens) {
            if (!searchIndex.has(token)) searchIndex.set(token, new Set())
            searchIndex.get(token)!.add(path)
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walk(rootDir, 0)
  return { pages, searchIndex }
}

/**
 * Search the wiki index
 */
export function searchWiki(index: WikiIndex, query: string, limit: number = 10): WikiPage[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  // Score pages by token matches
  const scores = new Map<string, number>()
  for (const token of tokens) {
    const pages = index.searchIndex.get(token)
    if (!pages) continue
    for (const page of pages) {
      scores.set(page, (scores.get(page) || 0) + 1)
    }
  }

  // Sort by score
  const sorted = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)

  return sorted
    .map(([path]) => index.pages.get(path))
    .filter((p): p is WikiPage => p !== undefined)
}

/**
 * Get a page by path
 */
export function getWikiPage(index: WikiIndex, path: string): WikiPage | undefined {
  return index.pages.get(path)
}

/**
 * List all pages
 */
export function listWikiPages(index: WikiIndex): WikiPage[] {
  return Array.from(index.pages.values())
}
