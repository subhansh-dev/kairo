/**
 * Kairo — Memory System
 * File-based memory with LLM-powered recall ()
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  name: string;
  description: string;
  content: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  timestamp: string;
  tags: string[];
}

// ─── Memory Manager ───────────────────────────────────────────────

export class MemoryManager {
  private dir: string;
  private index: string;

  constructor() {
    this.dir = join(homedir(), '.kairo', 'memory');
    this.index = join(this.dir, 'MEMORY.md');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.index)) writeFileSync(this.index, '# Kairo Memory Index\n\n');
  }

  save(name: string, content: string, type: Memory['type'] = 'project', tags: string[] = []): Memory {
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const memory: Memory = {
      id,
      name,
      description: content.split('\n')[0].slice(0, 100),
      content,
      type,
      timestamp: new Date().toISOString(),
      tags,
    };

    const frontmatter = [
      '---',
      `name: ${memory.name}`,
      `description: ${memory.description}`,
      `type: ${memory.type}`,
      `timestamp: ${memory.timestamp}`,
      `tags: [${tags.join(', ')}]`,
      '---',
      '',
      content,
    ].join('\n');

    const file = join(this.dir, `${id}.md`);
    writeFileSync(file, frontmatter);

    // Update index
    this.updateIndex();

    return memory;
  }

  search(query: string, limit = 5): Memory[] {
    const lower = query.toLowerCase();
    const files = readdirSync(this.dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    const results: Array<{ memory: Memory; score: number }> = [];

    for (const f of files) {
      try {
        const memory = this.parseMemory(join(this.dir, f));
        if (!memory) continue;

        let score = 0;
        // Name match
        if (memory.name.toLowerCase().includes(lower)) score += 10;
        // Tag match
        if (memory.tags.some(t => lower.includes(t))) score += 5;
        // Content match
        if (memory.content.toLowerCase().includes(lower)) score += 3;
        // Description match
        if (memory.description.toLowerCase().includes(lower)) score += 2;

        if (score > 0) results.push({ memory, score });
      } catch { /* skip */ }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.memory);
  }

  getAll(): Memory[] {
    const files = readdirSync(this.dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    return files.map(f => this.parseMemory(join(this.dir, f))).filter(Boolean) as Memory[];
  }

  renderForPrompt(query?: string): string {
    const memories = query ? this.search(query) : this.getAll().slice(0, 10);
    if (memories.length === 0) return '';

    const formatted = memories.map(m => {
      const age = this.formatAge(m.timestamp);
      return `- **${m.name}** (${m.type}, ${age}): ${m.description}`;
    }).join('\n');

    return `\n\nRelevant memories:\n${formatted}`;
  }

  private parseMemory(path: string): Memory | null {
    const content = readFileSync(path, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) {
        meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
    }

    return {
      id: path.split(/[/\\]/).pop()!.replace('.md', ''),
      name: meta.name || 'Unknown',
      description: meta.description || '',
      content: match[2],
      type: (meta.type as Memory['type']) || 'project',
      timestamp: meta.timestamp || '',
      tags: meta.tags ? meta.tags.replace(/[\[\]]/g, '').split(',').map(s => s.trim()) : [],
    };
  }

  private updateIndex() {
    const memories = this.getAll();
    const index = [
      '# Kairo Memory Index',
      '',
      ...memories.map(m => `- [${m.name}](${m.id}.md) — ${m.description}`),
      '',
    ].join('\n');
    writeFileSync(this.index, index);
  }

  private formatAge(timestamp: string): string {
    if (!timestamp) return 'unknown';
    const ms = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}

let _memory: MemoryManager | null = null;

export function getMemory(): MemoryManager {
  if (!_memory) _memory = new MemoryManager();
  return _memory;
}
