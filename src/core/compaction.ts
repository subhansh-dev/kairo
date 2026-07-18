/**
 * Kairo — Context Compaction System
 */

import type { ChatMessage } from '../providers/registry.js';

// ─── Token Estimation ───────────────────────────────────────────

/**
 * Fast token estimation: 1 token ≈ 4 characters
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(Buffer.byteLength(text, 'utf-8') / 4);
}

export function estimateMessageTokens(message: ChatMessage): number {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return estimateTokens(content);
}

export function estimateTotalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

// ─── Compaction Settings ────────────────────────────────────────

export interface CompactionSettings {
  enabled: boolean;
  strategy: 'context-full' | 'prune' | 'shake' | 'off';
  thresholdPercent: number;  // Trigger when context exceeds this % of window
  reserveTokens: number;     // Tokens reserved for model output
  keepRecentTokens: number;  // Keep this many tokens of recent conversation
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  strategy: 'context-full',
  thresholdPercent: 80,
  reserveTokens: 16384,
  keepRecentTokens: 16000,
};

/**
 * Effective reserve: at least 15% of context window or the configured floor, whichever is larger.
 * Prevents running out of output space on large context models.
 */
export function effectiveReserveTokens(contextWindow: number, settings: CompactionSettings): number {
  return Math.max(Math.floor(contextWindow * 0.15), settings.reserveTokens);
}
// ─── Should Compact? ────────────────────────────────────────────

export function shouldCompact(
  messages: ChatMessage[],
  contextWindow: number,
  settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS,
): boolean {
  if (!settings.enabled || settings.strategy === 'off') return false;
  const totalTokens = estimateTotalTokens(messages);
  const threshold = contextWindow * (settings.thresholdPercent / 100);
  return totalTokens > threshold;
}

// ─── Pruning ────────────────────────────────────

/**
 * Prune superseded tool results — if a file was read multiple times,
 * keep only the most recent read
 */
export function pruneSupersededReads(messages: ChatMessage[]): ChatMessage[] {
  const fileReads = new Map<string, number[]>(); // path → message indices

  // Find all file reads
  for (let i = 0; i < messages.length; i++) {
    const rawContent = messages[i].content;
    const content = typeof rawContent === 'string' ? rawContent : '';
    const readMatch = content.match(/Tool read:\n(.+?)\s+\[hash:/);
    if (readMatch) {
      const path = readMatch[1];
      if (!fileReads.has(path)) fileReads.set(path, []);
      fileReads.get(path)!.push(i);
    }
  }

  // Mark older reads as prunable (keep last read)
  const prunable = new Set<number>();
  for (const [, indices] of fileReads) {
    if (indices.length > 1) {
      // Keep the last read, prune all others
      for (let i = 0; i < indices.length - 1; i++) {
        prunable.add(indices[i]);
      }
    }
  }

  // Replace pruned messages with stubs
  return messages.map((m, i) => {
    if (prunable.has(i)) {
      return { ...m, content: '[Pruned: superseded by later read]' };
    }
    return m;
  });
}

/**
 * Prune useless tool results (empty outputs, errors that were retried)
 */
export function pruneUselessResults(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(m => {
    const content = typeof m.content === 'string' ? m.content : '';
    // Prune empty tool results
    if (content.includes('Tool ') && (content.includes('(no output)') || content.trim() === '')) {
      return { ...m, content: '[Pruned: empty result]' };
    }
    return m;
  });
}

// ─── Shake ─────────────────────────────────────

/**
 * Replace large tool outputs with summaries
 * Keeps the first N lines and last N lines, replaces the middle
 */
export function shakeLargeOutputs(messages: ChatMessage[], maxLines: number = 20): ChatMessage[] {
  return messages.map(m => {
    const content = typeof m.content === 'string' ? m.content : '';
    const lines = content.split('\n');

    if (lines.length <= maxLines) return m;

    const keepStart = Math.floor(maxLines / 2);
    const keepEnd = Math.floor(maxLines / 2);
    const pruned = [
      ...lines.slice(0, keepStart),
      `\n[... ${lines.length - maxLines} lines pruned ...]\n`,
      ...lines.slice(-keepEnd),
    ].join('\n');

    return { ...m, content: pruned };
  });
}

// ─── Full Compaction ────────────────────────────────────────────

export interface CompactionResult {
  messages: ChatMessage[];
  tokensBefore: number;
  tokensAfter: number;
  strategy: string;
}

/**
 * Compact messages using the configured strategy
 */
export function compactMessages(
  messages: ChatMessage[],
  settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS,
): CompactionResult {
  const tokensBefore = estimateTotalTokens(messages);

  let compacted: ChatMessage[];

  switch (settings.strategy) {
    case 'prune':
      compacted = pruneUselessResults(pruneSupersededReads(messages));
      break;

    case 'shake':
      compacted = shakeLargeOutputs(pruneUselessResults(pruneSupersededReads(messages)));
      break;

    case 'context-full': {
      // Keep system prompt + recent messages, summarize old ones
      const systemMsg = messages.find(m => m.role === 'system');
      const nonSystem = messages.filter(m => m.role !== 'system');

      // Find cut point to keep recent tokens
      let cutIndex = -1;
      let accTokens = 0;
      for (let i = nonSystem.length - 1; i >= 0; i--) {
        accTokens += estimateMessageTokens(nonSystem[i]);
        if (accTokens >= settings.keepRecentTokens) {
          cutIndex = i;
          break;
        }
      }

      // If all messages fit within keepRecentTokens, nothing to summarize
      if (cutIndex === -1) {
        compacted = messages;
        break;
      }

      const oldMessages = nonSystem.slice(0, cutIndex);
      const recentMessages = nonSystem.slice(cutIndex);

      // Create smarter summary: extract key info per message
      const summaryParts: string[] = [];
      const toolResults = new Map<string, string[]>(); // tool name → results
      const userRequests: string[] = [];
      const assistantDecisions: string[] = [];

      for (const m of oldMessages) {
        const content = typeof m.content === 'string' ? m.content : '';
        if (m.role === 'user') {
          const preview = content.slice(0, 200).replace(/\n/g, ' ');
          if (preview.trim()) userRequests.push(preview);
        } else if (m.role === 'assistant') {
          // Extract tool calls and key decisions
          const toolMatches = content.match(/!([a-zA-Z_-]+)/g);
          if (toolMatches) {
            for (const t of toolMatches) {
              const toolName = t.slice(1);
              if (!toolResults.has(toolName)) toolResults.set(toolName, []);
              toolResults.get(toolName)!.push(content.slice(0, 100));
            }
          }
          const preview = content.slice(0, 200).replace(/\n/g, ' ');
          if (preview.trim()) assistantDecisions.push(preview);
        }
      }

      if (userRequests.length > 0) summaryParts.push(`User asked: ${userRequests.slice(-3).join('; ')}`);
      if (toolResults.size > 0) {
        const toolSummary = [...toolResults.entries()].map(([t, r]) => `${t}(${r.length}x)`).join(', ');
        summaryParts.push(`Tools used: ${toolSummary}`);
      }
      if (assistantDecisions.length > 0) summaryParts.push(`Key: ${assistantDecisions.slice(-2).join('; ')}`);

      const summaryMsg: ChatMessage = {
        role: 'system',
        content: `[Context compacted: ${oldMessages.length} older messages summarized]\n${summaryParts.join('\n')}`,
      };

      compacted = systemMsg
        ? [systemMsg, summaryMsg, ...recentMessages]
        : [summaryMsg, ...recentMessages];
      break;
    }

    default:
      compacted = messages;
  }

  const tokensAfter = estimateTotalTokens(compacted);

  return {
    messages: compacted,
    tokensBefore,
    tokensAfter,
    strategy: settings.strategy,
  };
}

// ─── Micro-Compact ─────────────────────────────

/**
 * Lightweight per-turn compaction: trim verbose outputs,
 * collapse repeated patterns, remove redundant whitespace.
 */
export function microCompact(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(m => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    let trimmed = content;

    // Collapse multiple blank lines
    trimmed = trimmed.replace(/\n{3,}/g, '\n\n');

    // Trim very long tool outputs (keep first 40 + last 20 lines)
    if (trimmed.length > 3000) {
      const lines = trimmed.split('\n');
      if (lines.length > 60) {
        trimmed = lines.slice(0, 40).join('\n') +
          `\n\n[... ${lines.length - 60} lines trimmed ...]\n\n` +
          lines.slice(-20).join('\n');
      } else if (trimmed.length > 5000) {
        // Long single-line content: keep first 2000 + last 1000
        trimmed = trimmed.slice(0, 2000) + `\n[... ${trimmed.length - 3000} chars trimmed ...]\n` + trimmed.slice(-1000);
      }
    }

    // Remove duplicate consecutive lines (common in verbose logs)
    const deduped = trimmed.replace(/(^.*\n)(\1{2,})/gm, '$1  [... repeated lines ...]\n');
    if (deduped.length < trimmed.length * 0.8) trimmed = deduped;

    return trimmed === content ? m : { ...m, content: trimmed };
  });
}

// ─── Reactive Compact ──────────────────────────

/**
 * Compact triggered by context pressure (near limit).
 * More aggressive than auto-compact.
 */
export function reactiveCompact(
  messages: ChatMessage[],
  pressurePercent: number, // 0-1, how close to limit
  keepRecentTokens: number = 16000,
): CompactionResult {
  const tokensBefore = estimateTotalTokens(messages);

  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  // Find cut point based on token count, not message count ratio
  let cutIndex = -1;
  let accTokens = 0;
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    accTokens += estimateMessageTokens(nonSystem[i]);
    if (accTokens >= keepRecentTokens) {
      cutIndex = i;
      break;
    }
  }

  // If all messages fit within keepRecentTokens, apply minimal compaction
  if (cutIndex === -1) {
    const summaryMsg: ChatMessage = {
      role: 'system',
      content: `[Reactive compact — ${nonSystem.length} messages under ${Math.round(pressurePercent * 100)}% context pressure, all within keep threshold]`,
    };
    const compacted = systemMsg
      ? [systemMsg, summaryMsg]
      : [summaryMsg];
    return {
      messages: compacted,
      tokensBefore,
      tokensAfter: estimateTotalTokens(compacted),
      strategy: 'reactive',
    };
  }

  const oldMessages = nonSystem.slice(0, cutIndex);
  const recentMessages = nonSystem.slice(cutIndex);

  const summary = oldMessages.map(m => {
    const content = typeof m.content === 'string' ? m.content : '';
    return `${m.role}: ${content.slice(0, 150)}`;
  }).join('\n');

  const summaryMsg: ChatMessage = {
    role: 'system',
    content: `[Reactive compact — ${oldMessages.length} messages removed under ${Math.round(pressurePercent * 100)}% context pressure]\n${summary}`,
  };

  const compacted = systemMsg
    ? [systemMsg, summaryMsg, ...recentMessages]
    : [summaryMsg, ...recentMessages];

  return {
    messages: compacted,
    tokensBefore,
    tokensAfter: estimateTotalTokens(compacted),
    strategy: 'reactive',
  };
}

// ─── Session Memory Extraction ─────────────────

/**
 * Extract key facts and decisions from messages for long-term memory.
 */
export function extractSessionMemories(messages: ChatMessage[]): string[] {
  const memories: string[] = [];

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const content = typeof msg.content === 'string' ? msg.content : '';

    // Extract code decisions
    const decisionPattern = /(?:decided|chose|picked|going with|using)\s+(.{20,100})/gi;
    let match;
    while ((match = decisionPattern.exec(content))) {
      memories.push(`Decision: ${match[1].trim()}`);
    }

    // Extract file paths mentioned
    const pathPattern = /(?:created|modified|wrote|edited|fixed)\s+(?:file\s+)?[`"']?([\/\w.-]+\.\w+)[`"']?/gi;
    while ((match = pathPattern.exec(content))) {
      memories.push(`File: ${match[1]}`);
    }

    // Extract errors encountered
    const errorPattern = /(?:error|bug|issue|problem)[:\s]+(.{20,150})/gi;
    while ((match = errorPattern.exec(content))) {
      memories.push(`Error: ${match[1].trim()}`);
    }
  }

  // Deduplicate
  return [...new Set(memories)].slice(0, 20);
}

// ─── Compact Manager ───────────────────────────

export class CompactManager {
  private settings: CompactionSettings
  private compactCount = 0
  private lastCompactTokens = 0

  constructor(settings: Partial<CompactionSettings> = {}) {
    this.settings = { ...DEFAULT_COMPACTION_SETTINGS, ...settings };
  }

  /**
   * Check if compaction is needed and perform it.
   */
  maybeCompact(messages: ChatMessage[], contextWindow: number): { messages: ChatMessage[]; result?: CompactionResult } {
    if (!shouldCompact(messages, contextWindow, this.settings)) {
      // Micro-compact even when not over threshold
      if (this.settings.enabled) {
        return { messages: microCompact(messages) };
      }
      return { messages };
    }

    const result = compactMessages(messages, this.settings);
    this.compactCount++;
    this.lastCompactTokens = result.tokensBefore - result.tokensAfter;
    return { messages: result.messages, result };
  }

  /**
   * Get context pressure (0-1).
   */
  getPressure(messages: ChatMessage[], contextWindow: number): number {
    const totalTokens = estimateTotalTokens(messages);
    return Math.min(1, totalTokens / contextWindow);
  }

  /**
   * Get compaction stats.
   */
  getStats(): { compactCount: number; lastSavedTokens: number } {
    return {
      compactCount: this.compactCount,
      lastSavedTokens: this.lastCompactTokens,
    };
  }

  /**
   * Update settings.
   */
  updateSettings(settings: Partial<CompactionSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }
}
