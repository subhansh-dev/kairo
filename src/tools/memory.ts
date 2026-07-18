import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ToolDefinition, ToolResult } from './types.js';

const MEMORY_DIR = join(homedir(), '.kairo', 'memory');

// ─── Simple TF-IDF Embedding (no external deps) ───────────

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function computeTF(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  const len = tokens.length;
  for (const [key, val] of tf) {
    tf.set(key, val / len);
  }
  return tf;
}

interface IndexEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  timestamp: number;
  tf: Record<string, number>;
}

let index: IndexEntry[] = [];
let indexDirty = false;

function getIndexFile(): string {
  return join(MEMORY_DIR, 'index.json');
}

function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

function loadIndex(): void {
  ensureMemoryDir();
  const file = getIndexFile();
  if (!existsSync(file)) return;
  try {
    index = JSON.parse(readFileSync(file, 'utf-8'));
  } catch { index = []; }
}

function saveIndex(): void {
  if (!indexDirty) return;
  ensureMemoryDir();
  writeFileSync(getIndexFile(), JSON.stringify(index, null, 2));
  indexDirty = false;
}

function rebuildIndex(): void {
  ensureMemoryDir();
  index = [];
  const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && f !== 'index.md');
  for (const file of files) {
    try {
      const content = readFileSync(join(MEMORY_DIR, file), 'utf-8');
      const lines = content.split('\n');
      const title = lines.find(l => l.startsWith('# '))?.slice(2) || file;
      const tagsMatch = content.match(/^tags:\s*(.+)$/im);
      const tags = tagsMatch ? tagsMatch[1].split(/[,\s]+/).filter(Boolean) : [];
      const tf = computeTF(content);

      index.push({
        id: file.replace('.md', ''),
        title,
        content,
        tags,
        timestamp: parseInt(file.split('_')[0]) || Date.now(),
        tf: Object.fromEntries(tf),
      });
    } catch {}
  }
  indexDirty = true;
  saveIndex();
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    const va = a[key] || 0;
    const vb = b[key] || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

function searchMemories(query: string, limit: number = 10): Array<{ id: string; title: string; content: string; score: number }> {
  loadIndex();
  if (index.length === 0) rebuildIndex();

  const queryTF = computeTF(query);
  const queryVec = Object.fromEntries(queryTF);

  const scored = index
    .map(entry => ({
      ...entry,
      score: cosineSimilarity(queryVec, entry.tf),
    }))
    .filter(e => e.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(e => ({
    id: e.id,
    title: e.title,
    content: e.content.slice(0, 500),
    score: e.score,
  }));
}

function textSearchMemories(query: string, limit: number = 10): Array<{ id: string; title: string; content: string }> {
  loadIndex();
  if (index.length === 0) rebuildIndex();

  const lower = query.toLowerCase();
  const scored = index
    .map(entry => {
      const contentLower = entry.content.toLowerCase();
      let score = 0;
      if (contentLower.includes(lower)) score += 10;
      if (entry.title.toLowerCase().includes(lower)) score += 5;
      if (entry.tags.some(t => t.toLowerCase().includes(lower))) score += 3;
      // Count occurrences
      const occurrences = (contentLower.match(new RegExp(lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      score += occurrences;
      return { ...entry, score };
    })
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(e => ({
    id: e.id,
    title: e.title,
    content: e.content.slice(0, 500),
  }));
}

export const memoryTool: ToolDefinition = {
  name: 'memory',
  description: 'Persistent memory with embedding search. Usage: memory save <text> | memory search <query> | memory list | memory clear | memory rebuild',
  prompt: `Manage persistent memories that persist across sessions.
Uses TF-IDF embedding for semantic search — no external dependencies.

Usage:
- memory save <text> — save a memory (automatic tagging via #tags)
- memory search <query> — semantic search with TF-IDF
- memory textsearch <query> — exact text match search
- memory list — list all memories
- memory clear — clear all memories
- memory rebuild — rebuild search index
- memory get <id> — get a specific memory by id`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      ensureMemoryDir();
      const parts = args.split(/\s+/);
      const action = parts[0]?.toLowerCase();
      const text = parts.slice(1).join(' ');

      if (action === 'save' && text) {
        ensureMemoryDir();
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const file = join(MEMORY_DIR, `${id}.md`);
        const tags = (text.match(/#(\w+)/g) || []).map(t => t.slice(1));
        const tagsLine = tags.length > 0 ? `tags: ${tags.join(', ')}\n` : '';
        const content = `---\ntitle: ${text.split('\n')[0].slice(0, 80)}\ntimestamp: ${new Date().toISOString()}\n${tagsLine}---\n${text}`;
        writeFileSync(file, content);
        indexDirty = true;
        // Persist index immediately so a crash doesn't orphan this entry
        loadIndex();
        const tf = computeTF(content);
        index.push({
          id, title: text.split('\n')[0].slice(0, 80), content, tags,
          timestamp: Date.now(), tf: Object.fromEntries(tf),
        });
        indexDirty = true;
        saveIndex();
        return { output: `Saved memory: ${id}`, success: true, metadata: { id, tags } };
      }

      if (action === 'search' && text) {
        const results = searchMemories(text);
        if (results.length === 0) return { output: 'No matching memories found.', success: true };
        const output = results.map(r =>
          `[${r.id}] (${(r.score * 100).toFixed(0)}%) ${r.title}\n  ${r.content.slice(0, 200)}`
        ).join('\n---\n');
        return { output, success: true, metadata: { matches: results.length } };
      }

      if (action === 'textsearch' && text) {
        const results = textSearchMemories(text);
        if (results.length === 0) return { output: 'No matching memories found.', success: true };
        const output = results.map(r =>
          `[${r.id}] ${r.title}\n  ${r.content.slice(0, 200)}`
        ).join('\n---\n');
        return { output, success: true, metadata: { matches: results.length } };
      }

      if (action === 'list') {
        loadIndex();
        if (index.length === 0) rebuildIndex();
        const list = index.map(e =>
          `${e.id}: ${e.title.slice(0, 80)}${e.tags.length ? ` [${e.tags.join(', ')}]` : ''}`
        ).join('\n');
        return { output: list || 'No memories saved.', success: true, metadata: { count: index.length } };
      }

      if (action === 'get' && text) {
        loadIndex();
        const entry = index.find(e => e.id === text);
        if (!entry) return { output: `Memory not found: ${text}`, success: false };
        return { output: entry.content, success: true };
      }

      if (action === 'clear') {
        const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
        for (const f of files) unlinkSync(join(MEMORY_DIR, f));
        const idxFile = getIndexFile();
        if (existsSync(idxFile)) unlinkSync(idxFile);
        index = [];
        return { output: `Cleared ${files.length} memories.`, success: true };
      }

      if (action === 'rebuild') {
        rebuildIndex();
        return { output: `Rebuilt index: ${index.length} memories`, success: true, metadata: { count: index.length } };
      }

      return { output: 'Usage: memory save <text> | memory search <query> | memory textsearch <query> | memory list | memory get <id> | memory clear | memory rebuild', success: false };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
