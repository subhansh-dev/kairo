/**
 * Hook output spill — handle oversized hook outputs.
 *
 * Prevents runaway plugins from inflating every turn's prompt
 * by spilling oversized outputs to disk.
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SPILL_DIR = join(homedir(), '.kairo', 'hook-spill');
const DEFAULT_MAX_CHARS = 5_000;

export interface SpillConfig {
  maxChars: number;
  spillDir: string;
}

const DEFAULT_CONFIG: SpillConfig = {
  maxChars: DEFAULT_MAX_CHARS,
  spillDir: SPILL_DIR,
};

/**
 * Check if output exceeds the limit and spill to disk if needed.
 * Returns the original content if within limits, or a placeholder with file reference.
 */
export function spillIfOversized(
  content: string,
  opts: {
    sessionId?: string;
    source?: string;
    config?: SpillConfig;
  } = {},
): string {
  const config = opts.config || DEFAULT_CONFIG;
  if (!content || content.length <= config.maxChars) return content;

  try {
    if (!existsSync(config.spillDir)) mkdirSync(config.spillDir, { recursive: true });
    const filename = `${opts.source || 'hook'}_${Date.now()}.txt`;
    const filepath = join(config.spillDir, filename);
    writeFileSync(filepath, content, 'utf-8');

    const preview = content.slice(0, 200).replace(/\n/g, ' ');
    return `[Hook output spilled to ${filepath} (${content.length} chars)]\nPreview: ${preview}…`;
  } catch {
    // If spill fails, truncate instead
    return content.slice(0, config.maxChars) + '\n… [truncated]';
  }
}

/**
 * Get the spill configuration.
 */
export function getSpillConfig(): SpillConfig {
  return DEFAULT_CONFIG;
}
