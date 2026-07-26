/**
 * MoA turn trace persistence.
 *
 * Persists full MoA turn traces for auditing: what every model saw,
 * what every model said, and what it cost.
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface MoATraceEntry {
  timestamp: string;
  sessionId: string;
  presetName: string;
  references: Array<{
    label: string;
    model: string;
    provider: string;
    temperature: number;
    inputMessages: unknown[];
    output: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
    costUsd: number | null;
  }>;
  aggregator: {
    model: string;
    provider: string;
    inputMessages: unknown[];
    output: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
    costUsd: number | null;
  } | null;
  totalCostUsd: number | null;
}

/**
 * Get the trace directory.
 */
function getTraceDir(): string {
  const override = process.env.KAIRO_MOA_TRACE_DIR;
  if (override) return override;
  return join(homedir(), '.kairo', 'moa-traces');
}

/**
 * Sanitize a session ID for use as a filename.
 */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown-session';
}

/**
 * Save a MoA turn trace to disk.
 */
export function saveMoATurn(trace: MoATraceEntry): void {
  try {
    const traceDir = getTraceDir();
    if (!existsSync(traceDir)) mkdirSync(traceDir, { recursive: true });

    const filename = sanitizeSessionId(trace.sessionId) + '.jsonl';
    const filepath = join(traceDir, filename);

    const line = JSON.stringify({
      ...trace,
      timestamp: new Date().toISOString(),
    }) + '\n';

    appendFileSync(filepath, line, 'utf-8');
  } catch {
    // Tracing is best-effort — never break a turn over it
  }
}

/**
 * Build a trace entry from MoA execution data.
 */
export function buildMoATrace(opts: {
  sessionId: string;
  presetName: string;
  references: Array<{
    model: string;
    provider: string;
    temperature: number;
    messages: unknown[];
    output: string;
    usage: { inputTokens: number; outputTokens: number };
    costUsd: number | null;
  }>;
  aggregator?: {
    model: string;
    provider: string;
    messages: unknown[];
    output: string;
    usage: { inputTokens: number; outputTokens: number };
    costUsd: number | null;
  };
}): MoATraceEntry {
  const refs = opts.references.map((r, i) => ({
    label: `reference_${i}`,
    model: r.model,
    provider: r.provider,
    temperature: r.temperature,
    inputMessages: r.messages,
    output: r.output,
    usage: r.usage,
    costUsd: r.costUsd,
  }));

  const totalCostUsd = refs.reduce((sum, r) => sum + (r.costUsd || 0), 0)
    + (opts.aggregator?.costUsd || 0);

  return {
    timestamp: new Date().toISOString(),
    sessionId: opts.sessionId,
    presetName: opts.presetName,
    references: refs,
    aggregator: opts.aggregator ? {
      model: opts.aggregator.model,
      provider: opts.aggregator.provider,
      inputMessages: opts.aggregator.messages,
      output: opts.aggregator.output,
      usage: opts.aggregator.usage,
      costUsd: opts.aggregator.costUsd,
    } : null,
    totalCostUsd: totalCostUsd || null,
  };
}
