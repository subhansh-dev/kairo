/**
 * Kairo — Cost Tracking + Insights
 */

import type { Usage } from '../providers/types.js';

// ─── Cost Rates (USD per 1M tokens) ────────────────────────────

export type ModelCosts = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

const COST_RATES: Record<string, ModelCosts> = {
  // ── NVIDIA NIM (nemotron-3-ultra) ──
  'nvidia/nemotron-3-ultra-550b-a55b': { input: 0, output: 0 },

  // ── Groq (gpt-oss-120b / 20b) ──
  'gpt-oss-120b': { input: 0.15, output: 0.75 },
  'gpt-oss-20b':  { input: 0.04, output: 0.20 },

  // ── Cerebras (gpt-oss-120b / 20b) ──
  'cerebras/gpt-oss-120b': { input: 0.15, output: 0.75 },
  'cerebras/gpt-oss-20b':  { input: 0.04, output: 0.20 },
};

// ─── Usage Tracking ─────────────────────────────────────────────

interface UsageEntry {
  timestamp: number;
  model: string;
  provider: string;
  usage: Usage;
  cost: number;
  duration: number;
}

interface SessionStats {
  totalTokens: number;
  totalCost: number;
  totalDuration: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  modelBreakdown: Map<string, { tokens: number; cost: number; requests: number }>;
}

const sessionUsage: UsageEntry[] = [];

/**
 * Track a usage event
 */
export function trackUsage(
  model: string,
  provider: string,
  usage: Usage,
  duration: number = 0,
): void {
  const rates = COST_RATES[model] || { input: 0, output: 0 };
  const cost = (usage.input * rates.input + usage.output * rates.output) / 1_000_000;

  sessionUsage.push({
    timestamp: Date.now(),
    model,
    provider,
    usage,
    cost,
    duration,
  });
}

/**
 * Get session statistics
 */
export function getSessionStats(): SessionStats {
  const modelBreakdown = new Map<string, { tokens: number; cost: number; requests: number }>();

  let totalTokens = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  for (const entry of sessionUsage) {
    totalTokens += entry.usage.totalTokens;
    totalCost += entry.cost;
    totalDuration += entry.duration;
    inputTokens += entry.usage.input;
    outputTokens += entry.usage.output;
    cacheReadTokens += entry.usage.cacheRead;
    cacheWriteTokens += entry.usage.cacheWrite;

    const existing = modelBreakdown.get(entry.model) || { tokens: 0, cost: 0, requests: 0 };
    existing.tokens += entry.usage.totalTokens;
    existing.cost += entry.cost;
    existing.requests++;
    modelBreakdown.set(entry.model, existing);
  }

  return {
    totalTokens,
    totalCost,
    totalDuration,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    requestCount: sessionUsage.length,
    modelBreakdown,
  };
}

/**
 * Format stats for display
 */
export function formatStats(): string {
  const stats = getSessionStats();
  const lines: string[] = [];

  lines.push(`Tokens: ${stats.totalTokens.toLocaleString()} (in: ${stats.inputTokens.toLocaleString()}, out: ${stats.outputTokens.toLocaleString()})`);

  if (stats.cacheReadTokens > 0) {
    lines.push(`Cache: ${stats.cacheReadTokens.toLocaleString()} read, ${stats.cacheWriteTokens.toLocaleString()} write`);
  }

  if (stats.totalCost > 0) {
    lines.push(`Cost: $${stats.totalCost.toFixed(4)}`);
  } else {
    lines.push(`Cost: $0.00 (free tier)`);
  }

  lines.push(`Requests: ${stats.requestCount}`);

  if (stats.totalDuration > 0) {
    lines.push(`Duration: ${(stats.totalDuration / 1000).toFixed(1)}s`);
  }

  // Model breakdown
  if (stats.modelBreakdown.size > 1) {
    lines.push('\nPer model:');
    for (const [model, data] of stats.modelBreakdown) {
      lines.push(`  ${model}: ${data.tokens.toLocaleString()} tokens, ${data.requests} requests`);
    }
  }

  return lines.join('\n');
}

/**
 * Reset session stats
 */
export function resetStats(): void {
  sessionUsage.length = 0;
}
