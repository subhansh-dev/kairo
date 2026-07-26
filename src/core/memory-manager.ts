/**
 * Kairo — Memory Manager
 * Orchestrates memory providers for the agent.
 * Ported from Hermes Agent's memory_manager.py
 */

import { formatMemoriesForContext, extractMemories, storeMemories } from './memory-extract.js';
import { recordMemoryAccess } from './learning-graph.js';

// ─── Types ──────────────────────────────────────────────────────

export interface MemoryProvider {
  name: string;
  prefetch(query: string): Promise<string>;
  sync(userMsg: string, assistantResponse: string): Promise<void>;
  search(query: string, limit?: number): Promise<string[]>;
}

export interface MemoryContext {
  memories: string;
  userPreferences: string;
  projectConventions: string;
}

// ─── Manager ────────────────────────────────────────────────────

export class MemoryManager {
  private providers: MemoryProvider[] = [];
  private cache = new Map<string, string>();

  /**
   * Register a memory provider.
   */
  addProvider(provider: MemoryProvider): void {
    // Only one external provider allowed
    const existing = this.providers.findIndex(p => p.name === provider.name);
    if (existing >= 0) {
      this.providers[existing] = provider;
    } else {
      this.providers.push(provider);
    }
  }

  /**
   * Build memory context for the system prompt.
   */
  buildSystemPrompt(): string {
    const parts: string[] = [];

    // Built-in memory
    const memories = formatMemoriesForContext(undefined, 5);
    if (memories) parts.push(memories);

    return parts.join('\n\n');
  }

  /**
   * Prefetch memories relevant to the current query.
   */
  async prefetch(query: string): Promise<MemoryContext> {
    const results: MemoryContext = {
      memories: '',
      userPreferences: '',
      projectConventions: '',
    };

    // Built-in memory
    const builtIn = formatMemoriesForContext(query, 3);
    if (builtIn) results.memories = builtIn;

    // External providers
    for (const provider of this.providers) {
      try {
        const context = await provider.prefetch(query);
        if (context) results.memories += '\n' + context;
      } catch {}
    }

    return results;
  }

  /**
   * Sync conversation to memory providers.
   */
  async sync(userMsg: string, assistantResponse: string): Promise<void> {
    // Built-in memory extraction
    const extracted = extractMemories('user', userMsg, '');
    if (extracted.length > 0) {
      storeMemories(extracted);
    }

    // External providers
    for (const provider of this.providers) {
      try {
        await provider.sync(userMsg, assistantResponse);
      } catch {}
    }
  }

  /**
   * Search all memory providers.
   */
  async search(query: string, limit: number = 10): Promise<string[]> {
    const results: string[] = [];

    for (const provider of this.providers) {
      try {
        const hits = await provider.search(query, limit);
        results.push(...hits);
      } catch {}
    }

    return results.slice(0, limit);
  }
}
