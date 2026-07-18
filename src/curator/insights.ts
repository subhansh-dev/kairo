/**
 * Kairo — Insights Engine
 * Session analytics, token/cost analysis, model breakdown, activity patterns
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const INSIGHTS_DIR = join(homedir(), '.kairo', 'curator', 'insights');

function ensureDir(): void {
  if (!existsSync(INSIGHTS_DIR)) mkdirSync(INSIGHTS_DIR, { recursive: true });
}

// ─── Analytics Types ──────────────────────────────────────

export interface SessionAnalytics {
  totalSessions: number;
  totalTurns: number;
  totalTokens: number;
  totalCost: number;
  totalDuration: number;
  modelsUsed: Map<string, ModelStats>;
  toolsUsed: Map<string, ToolStats>;
  errorsByType: Map<string, number>;
  timeSeries: TimeSeriesPoint[];
}

export interface ModelStats {
  sessions: number;
  tokens: number;
  cost: number;
  duration: number;
  avgTokensPerSession: number;
}

export interface ToolStats {
  calls: number;
  successes: number;
  failures: number;
  avgDuration: number;
}

export interface TimeSeriesPoint {
  date: string;
  sessions: number;
  tokens: number;
  cost: number;
}

// ─── Log-based Analytics ──────────────────────────────────

interface LogEntry {
  timestamp: number;
  type: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  tokens?: { input: number; output: number };
  cost?: number;
  duration?: number;
  tool?: string;
  success?: boolean;
  error?: string;
}

const LOG_FILE = join(INSIGHTS_DIR, 'analytics.jsonl');

export function logAnalytics(entry: Omit<LogEntry, 'timestamp'>): void {
  ensureDir();
  const logEntry: LogEntry = { ...entry, timestamp: Date.now() };
  try {
    appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n', 'utf-8');
  } catch {}
}

export function getAnalytics(days?: number): SessionAnalytics {
  ensureDir();
  if (!existsSync(LOG_FILE)) return defaultAnalytics();

  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const entries = readLogEntries(cutoff);

  const analytics = defaultAnalytics();

  for (const entry of entries) {
    analytics.totalSessions++;

    if (entry.model) {
      const stats = analytics.modelsUsed.get(entry.model) || { sessions: 0, tokens: 0, cost: 0, duration: 0, avgTokensPerSession: 0 };
      stats.sessions++;
      if (entry.tokens) {
        stats.tokens += entry.tokens.input + entry.tokens.output;
        analytics.totalTokens += entry.tokens.input + entry.tokens.output;
      }
      if (entry.cost) { stats.cost += entry.cost; analytics.totalCost += entry.cost; }
      if (entry.duration) { stats.duration += entry.duration; analytics.totalDuration += entry.duration; }
      stats.avgTokensPerSession = stats.sessions > 0 ? stats.tokens / stats.sessions : 0;
      analytics.modelsUsed.set(entry.model, stats);
    }

    if (entry.tool) {
      const stats = analytics.toolsUsed.get(entry.tool) || { calls: 0, successes: 0, failures: 0, avgDuration: 0 };
      stats.calls++;
      if (entry.success === true) stats.successes++;
      if (entry.success === false) stats.failures++;
      analytics.toolsUsed.set(entry.tool, stats);
    }

    if (entry.error) {
      analytics.errorsByType.set(entry.error, (analytics.errorsByType.get(entry.error) || 0) + 1);
    }
  }

  // Build time series
  const daily = new Map<string, { sessions: number; tokens: number; cost: number }>();
  for (const entry of entries) {
    const date = new Date(entry.timestamp).toISOString().slice(0, 10);
    const day = daily.get(date) || { sessions: 0, tokens: 0, cost: 0 };
    day.sessions++;
    if (entry.tokens) day.tokens += entry.tokens.input + entry.tokens.output;
    if (entry.cost) day.cost += entry.cost;
    daily.set(date, day);
  }
  analytics.timeSeries = Array.from(daily.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  return analytics;
}

// ─── Report Generation ────────────────────────────────────

export function generateAnalyticsReport(days?: number): string {
  const analytics = getAnalytics(days);
  const lines: string[] = ['=== Kairo Analytics Report ===', ''];

  lines.push(`Period: ${days ? `Last ${days} days` : 'All time'}`);
  lines.push(`Sessions: ${analytics.totalSessions}`);
  lines.push(`Total tokens: ${analytics.totalTokens.toLocaleString()}`);
  lines.push(`Total cost: $${analytics.totalCost.toFixed(4)}`);
  lines.push(`Total duration: ${(analytics.totalDuration / 1000).toFixed(0)}s`);
  lines.push('');

  if (analytics.modelsUsed.size > 0) {
    lines.push('Models:');
    const sorted = [...analytics.modelsUsed.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
    for (const [model, stats] of sorted.slice(0, 10)) {
      const pct = analytics.totalTokens > 0 ? ((stats.tokens / analytics.totalTokens) * 100).toFixed(1) : '0';
      lines.push(`  ${model}: ${stats.tokens.toLocaleString()} tokens (${pct}%), ${stats.sessions} sessions`);
    }
    lines.push('');
  }

  if (analytics.toolsUsed.size > 0) {
    lines.push('Tools:');
    const sorted = [...analytics.toolsUsed.entries()].sort((a, b) => b[1].calls - a[1].calls);
    for (const [tool, stats] of sorted.slice(0, 10)) {
      const rate = stats.calls > 0 ? ((stats.successes / stats.calls) * 100).toFixed(0) : '0';
      lines.push(`  ${tool}: ${stats.calls}x (${rate}% success)`);
    }
    lines.push('');
  }

  if (analytics.errorsByType.size > 0) {
    lines.push('Top errors:');
    const sorted = [...analytics.errorsByType.entries()].sort((a, b) => b[1] - a[1]);
    for (const [error, count] of sorted.slice(0, 5)) {
      lines.push(`  ${error}: ${count}x`);
    }
    lines.push('');
  }

  if (analytics.timeSeries.length > 0) {
    lines.push('Activity (last 7 days):');
    const recent = analytics.timeSeries.slice(-7);
    for (const day of recent) {
      lines.push(`  ${day.date}: ${day.sessions} sessions, ${day.tokens.toLocaleString()} tokens`);
    }
  }

  return lines.join('\n');
}

// ─── Internal Helpers ─────────────────────────────────────

function readLogEntries(cutoff: number): LogEntry[] {
  const content = readFileSync(LOG_FILE, 'utf-8');
  return content.trim().split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((e): e is LogEntry => e !== null && e.timestamp >= cutoff);
}

function defaultAnalytics(): SessionAnalytics {
  return {
    totalSessions: 0,
    totalTurns: 0,
    totalTokens: 0,
    totalCost: 0,
    totalDuration: 0,
    modelsUsed: new Map(),
    toolsUsed: new Map(),
    errorsByType: new Map(),
    timeSeries: [],
  };
}
