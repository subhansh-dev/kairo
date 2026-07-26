/**
 * Kairo — Shake Compaction
 * Surgical context reduction: replaces heavy tool outputs with short placeholders.
 * Much cheaper than full summarization — no LLM call needed.
 */

import type { ChatMessage } from '../providers/registry.js';
import { estimateTokens } from './compaction.js';

// ─── Helpers ───────────────────────────────────────────────

function contentStr(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  return content.map(b => b.text || '').join('\n');
}

// ─── Types ─────────────────────────────────────────────────

export interface ShakeConfig {
  protectTokens: number;
  minSavings: number;
  blockMinTokens: number;
}

export const DEFAULT_SHAKE_CONFIG: ShakeConfig = {
  protectTokens: 8000,
  minSavings: 500,
  blockMinTokens: 200,
};

// ─── Shake Logic ───────────────────────────────────────────

/**
 * Shake a conversation — replace old, heavy tool outputs with short placeholders.
 */
export function shake(
  messages: ChatMessage[],
  config: ShakeConfig = DEFAULT_SHAKE_CONFIG,
): { messages: ChatMessage[]; savedTokens: number } {
  if (messages.length === 0) return { messages, savedTokens: 0 };

  // Protect the most recent messages
  let protectedTokens = 0;
  let protectIdx = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(contentStr(messages[i].content));
    if (protectedTokens + tokens > config.protectTokens) break;
    protectedTokens += tokens;
    protectIdx = i;
  }

  // Shake messages before the protected window
  const result: ChatMessage[] = [];
  let totalSaved = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const text = contentStr(msg.content);
    const tokens = estimateTokens(text);

    if (i >= protectIdx || tokens < config.blockMinTokens) {
      result.push(msg);
      continue;
    }

    // Try to shake tool output patterns
    const shaken = tryShake(text, tokens, config);
    if (shaken) {
      totalSaved += shaken.savedTokens;
      result.push({ ...msg, content: shaken.replacement });
    } else {
      result.push(msg);
    }
  }

  if (totalSaved < config.minSavings) {
    return { messages, savedTokens: 0 };
  }

  return { messages: result, savedTokens: totalSaved };
}

function tryShake(text: string, tokens: number, config: ShakeConfig): { replacement: string; savedTokens: number } | null {
  // Shake tool output blocks
  const toolMatch = text.match(/^(Tool \w+ result:?\s*)/i);
  if (toolMatch) {
    const header = toolMatch[1];
    const body = text.slice(header.length);
    const bodyTokens = estimateTokens(body);
    if (bodyTokens >= config.blockMinTokens) {
      const replacement = header + `[output: ${body.length.toLocaleString()} chars, ${bodyTokens} tokens — shaken]`;
      return { replacement, savedTokens: tokens - estimateTokens(replacement) };
    }
  }

  // Shake large code blocks
  const codeBlocks = text.match(/(```[\s\S]*?```)/g);
  if (codeBlocks) {
    let replaced = text;
    let saved = 0;
    for (const block of codeBlocks) {
      const blockTokens = estimateTokens(block);
      if (blockTokens >= config.blockMinTokens) {
        const lines = block.split('\n').length;
        const placeholder = '```\n[code block: ' + lines + ' lines, ' + blockTokens + ' tokens — shaken]\n```';
        replaced = replaced.replace(block, placeholder);
        saved += blockTokens - estimateTokens(placeholder);
      }
    }
    if (saved > 0) {
      return { replacement: replaced, savedTokens: saved };
    }
  }

  return null;
}
