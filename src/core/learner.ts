/**
 * Kairo — Learned Model Selection (Fugu-style)
 * Tracks model performance per task type over time.
 * Persists stats to ~/.kairo/perf_stats.json.
 * Used by coordinator to pick the historically best model for each role/task combo.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATS_DIR = join(homedir(), '.kairo');
const STATS_FILE = join(STATS_DIR, 'perf_stats.json');

// ─── Types ──────────────────────────────────────────────────

export interface ModelPerf {
  successes: number;
  failures: number;
  totalLatencyMs: number;
  totalTokens: number;
  lastUsed: number; // epoch ms
  /** Rolling average quality score (0-1) from verifier feedback */
  qualityScore: number;
}

export interface PerfStats {
  /** Key: `${taskType}:${provider}/${model}` */
  models: Record<string, ModelPerf>;
  /** Global model rankings per task type */
  rankings: Record<string, string[]>; // taskType → sorted model keys
  version: number;
}

// ─── Load / Save ────────────────────────────────────────────

let _stats: PerfStats | null = null;

export function loadStats(): PerfStats {
  if (_stats) return _stats;
  if (existsSync(STATS_FILE)) {
    try {
      _stats = JSON.parse(readFileSync(STATS_FILE, 'utf-8'));
      if (_stats && _stats.version === 1) return _stats;
    } catch { /* corrupted — reset */ }
  }
  _stats = { models: {}, rankings: {}, version: 1 };
  return _stats;
}

export function saveStats(): void {
  if (!_stats) return;
  try {
    if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });
    writeFileSync(STATS_FILE, JSON.stringify(_stats, null, 2));
  } catch { /* non-fatal */ }
}

// ─── Record Performance ─────────────────────────────────────

function key(taskType: string, provider: string, model: string): string {
  return `${taskType}:${provider}/${model}`;
}

export function recordSuccess(taskType: string, provider: string, model: string, latencyMs: number, tokens: number): void {
  const stats = loadStats();
  const k = key(taskType, provider, model);
  const entry = stats.models[k] || { successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0, lastUsed: 0, qualityScore: 0.5 };
  entry.successes++;
  entry.totalLatencyMs += latencyMs;
  entry.totalTokens += tokens;
  entry.lastUsed = Date.now();
  // Exponential moving average: success moves quality up
  entry.qualityScore = entry.qualityScore * 0.8 + 1.0 * 0.2;
  stats.models[k] = entry;
  updateRankings(stats, taskType);
  saveStats();
}

export function recordFailure(taskType: string, provider: string, model: string): void {
  const stats = loadStats();
  const k = key(taskType, provider, model);
  const entry = stats.models[k] || { successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0, lastUsed: 0, qualityScore: 0.5 };
  entry.failures++;
  entry.lastUsed = Date.now();
  // Failure moves quality down
  entry.qualityScore = entry.qualityScore * 0.8 + 0.0 * 0.2;
  stats.models[k] = entry;
  updateRankings(stats, taskType);
  saveStats();
}

export function recordVerifierFeedback(taskType: string, provider: string, model: string, approved: boolean): void {
  const stats = loadStats();
  const k = key(taskType, provider, model);
  const entry = stats.models[k] || { successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0, lastUsed: 0, qualityScore: 0.5 };
  // Approved → quality moves toward 1.0, rejected → toward 0.0
  entry.qualityScore = entry.qualityScore * 0.7 + (approved ? 1.0 : 0.0) * 0.3;
  stats.models[k] = entry;
  updateRankings(stats, taskType);
  saveStats();
}

// ─── Rankings ───────────────────────────────────────────────

function updateRankings(stats: PerfStats, taskType: string): void {
  const relevant = Object.entries(stats.models)
    .filter(([k]) => k.startsWith(taskType + ':'))
    .map(([k, v]) => ({
      key: k,
      // Composite score: quality (70%) + success rate (20%) + recency (10%)
      score:
        v.qualityScore * 0.7 +
        (v.successes + v.failures > 0 ? v.successes / (v.successes + v.failures) : 0.5) * 0.2 +
        (v.lastUsed > Date.now() - 86400000 ? 1 : 0.5) * 0.1,
    }))
    .sort((a, b) => b.score - a.score);

  stats.rankings[taskType] = relevant.map(r => r.key);
}

// ─── Query ──────────────────────────────────────────────────

/**
 * Get the best model for a task type based on learned performance.
 * Returns null if no data exists yet (use default routing).
 */
export function getBestModel(taskType: string): { provider: string; model: string } | null {
  const stats = loadStats();
  const ranking = stats.rankings[taskType];
  if (!ranking || ranking.length === 0) return null;

  // Pick the top-ranked model
  const topKey = ranking[0];
  const parts = topKey.split(':');
  if (parts.length < 2) return null;
  const providerModel = parts[1];
  const slashIdx = providerModel.indexOf('/');
  if (slashIdx < 0) return null;

  return {
    provider: providerModel.slice(0, slashIdx),
    model: providerModel.slice(slashIdx + 1),
  };
}

/**
 * Get a model that HASN'T been tried yet for this task (exploration).
 * Used to discover new good models. Returns null if all models have been tried.
 */
export function getUnexploredModel(taskType: string, availableModels: Array<{ provider: string; model: string }>): { provider: string; model: string } | null {
  const stats = loadStats();
  for (const m of availableModels) {
    const k = key(taskType, m.provider, m.model);
    if (!stats.models[k]) return m; // Never tried → explore
  }
  return null; // All tried
}

/**
 * Get performance stats for a specific model.
 */
export function getModelStats(taskType: string, provider: string, model: string): ModelPerf | null {
  const stats = loadStats();
  return stats.models[key(taskType, provider, model)] || null;
}

/**
 * Get a human-readable summary of model performance.
 */
export function getStatsSummary(): string {
  const stats = loadStats();
  const entries = Object.entries(stats.models);
  if (entries.length === 0) return 'No performance data yet.';

  const lines = entries
    .sort((a, b) => b[1].qualityScore - a[1].qualityScore)
    .slice(0, 10)
    .map(([k, v]) => {
      const rate = v.successes + v.failures > 0
        ? `${Math.round(v.successes / (v.successes + v.failures) * 100)}%`
        : 'N/A';
      return `  ${k}: quality=${v.qualityScore.toFixed(2)} success=${rate} calls=${v.successes + v.failures}`;
    });

  return `Model Performance (top 10):\n${lines.join('\n')}`;
}
