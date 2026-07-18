/**
 * Kairo — Curator Engine (Self-Improvement System)
 * Background session review that extracts insights, improves skills, detects patterns
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CURATOR_DIR = join(homedir(), '.kairo', 'curator');
const INSIGHTS_DIR = join(CURATOR_DIR, 'insights');
const REVIEWS_DIR = join(CURATOR_DIR, 'reviews');

interface SessionData {
  id: string;
  prompt: string;
  response: string;
  tools: string[];
  toolCount: number;
  tokens: { input: number; output: number };
  model: string;
  provider: string;
  duration: number;
  success: boolean;
  error?: string;
}

interface Insight {
  id: string;
  title: string;
  category: 'pattern' | 'improvement' | 'optimization' | 'skill' | 'warning';
  content: string;
  source: string;
  created: number;
  applied: boolean;
}

interface SkillSuggestion {
  name: string;
  content: string;
  applicability: string;
  priority: number;
}

function ensureDirs(): void {
  for (const dir of [CURATOR_DIR, INSIGHTS_DIR, REVIEWS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

// ─── Insight Management ────────────────────────────────────

function loadInsights(): Insight[] {
  ensureDirs();
  const file = join(INSIGHTS_DIR, 'insights.json');
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return []; }
}

function saveInsights(insights: Insight[]): void {
  ensureDirs();
  writeFileSync(join(INSIGHTS_DIR, 'insights.json'), JSON.stringify(insights, null, 2));
}

export function addInsight(
  title: string,
  category: Insight['category'],
  content: string,
  source: string,
): Insight {
  const insights = loadInsights();
  const insight: Insight = {
    id: `ins_${Date.now().toString(36)}`,
    title,
    category,
    content,
    source,
    created: Date.now(),
    applied: false,
  };
  insights.push(insight);
  // Keep max 100 insights, remove oldest applied ones
  const filtered = insights
    .sort((a, b) => (a.applied === b.applied ? 0 : a.applied ? 1 : -1))
    .slice(0, 100);
  saveInsights(filtered);
  return insight;
}

export function getInsights(category?: Insight['category']): Insight[] {
  const insights = loadInsights();
  if (category) return insights.filter(i => i.category === category);
  return insights;
}

export function markInsightApplied(id: string): void {
  const insights = loadInsights();
  const idx = insights.findIndex(i => i.id === id);
  if (idx !== -1) {
    insights[idx].applied = true;
    saveInsights(insights);
  }
}

// ─── Session Review ────────────────────────────────────────

function reviewLogPath(): string {
  return join(REVIEWS_DIR, `review_${new Date().toISOString().slice(0, 10)}.jsonl`);
}

export function recordSession(session: SessionData): void {
  ensureDirs();
  const line = JSON.stringify({ ...session, reviewed: false, timestamp: Date.now() }) + '\n';
  try {
    appendFileSync(reviewLogPath(), line, 'utf-8');
  } catch {}
}

export function getUnreviewedSessions(): SessionData[] {
  ensureDirs();
  const sessions: SessionData[] = [];
  const files = readdirSync(REVIEWS_DIR).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const content = readFileSync(join(REVIEWS_DIR, file), 'utf-8');
    for (const line of content.trim().split('\n')) {
      if (!line) continue;
      try {
        const s = JSON.parse(line);
        if (!s.reviewed) sessions.push(s);
      } catch {}
    }
  }
  return sessions;
}

export function markReviewed(id: string): void {
  const files = readdirSync(REVIEWS_DIR).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const path = join(REVIEWS_DIR, file);
    const content = readFileSync(path, 'utf-8');
    const lines = content.trim().split('\n').map(line => {
      try {
        const s = JSON.parse(line);
        if (s.id === id) s.reviewed = true;
        return JSON.stringify(s);
      } catch { return line; }
    });
    writeFileSync(path, lines.join('\n') + '\n');
  }
}

// ─── Skill Suggestions ─────────────────────────────────────

export function suggestSkill(title: string, content: string, applicability: string): SkillSuggestion {
  ensureDirs();
  const file = join(CURATOR_DIR, 'skill-suggestions.json');
  let suggestions: SkillSuggestion[] = [];
  if (existsSync(file)) {
    try { suggestions = JSON.parse(readFileSync(file, 'utf-8')); } catch {}
  }
  // Deduplicate by name
  const existing = suggestions.findIndex(s => s.name === title);
  const suggestion: SkillSuggestion = { name: title, content, applicability, priority: Date.now() };
  if (existing !== -1) {
    suggestions[existing] = suggestion;
  } else {
    suggestions.push(suggestion);
  }
  writeFileSync(file, JSON.stringify(suggestions, null, 2));
  return suggestion;
}

export function getSkillSuggestions(): SkillSuggestion[] {
  ensureDirs();
  const file = join(CURATOR_DIR, 'skill-suggestions.json');
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return []; }
}

// ─── Tool Pattern Detection ────────────────────────────────

interface ToolPattern {
  tool: string;
  frequency: number;
  successRate: number;
  avgDuration: number;
  commonErrors: Map<string, number>;
}

export function analyzeToolPatterns(sessions: SessionData[]): ToolPattern[] {
  const patternMap = new Map<string, { count: number; success: number; totalDuration: number; errors: Map<string, number> }>();

  for (const s of sessions) {
    for (const tool of s.tools || []) {
      const existing = patternMap.get(tool) || { count: 0, success: 0, totalDuration: 0, errors: new Map() };
      existing.count++;
      if (s.success) existing.success++;
      existing.totalDuration += s.duration || 0;
      if (s.error) {
        const errCount = existing.errors.get(s.error) || 0;
        existing.errors.set(s.error, errCount + 1);
      }
      patternMap.set(tool, existing);
    }
  }

  return Array.from(patternMap.entries()).map(([tool, data]) => ({
    tool,
    frequency: data.count,
    successRate: data.count > 0 ? data.success / data.count : 1,
    avgDuration: data.count > 0 ? data.totalDuration / data.count : 0,
    commonErrors: data.errors,
  })).sort((a, b) => b.frequency - a.frequency);
}

// ─── Performance Report ────────────────────────────────────

export function generateReport(): string {
  const sessions = getUnreviewedSessions();
  const insights = loadInsights();
  const suggestions = getSkillSuggestions();

  if (sessions.length === 0 && insights.length === 0 && suggestions.length === 0) {
    return 'No curator data yet.';
  }

  const lines: string[] = ['=== Kairo Curator Report ===', ''];

  if (sessions.length > 0) {
    const patterns = analyzeToolPatterns(sessions);
    lines.push(`Sessions in review: ${sessions.length}`);
    lines.push(`Tool patterns (top 5):`);
    for (const p of patterns.slice(0, 5)) {
      const pct = (p.successRate * 100).toFixed(0);
      const avg = p.avgDuration.toFixed(0);
      lines.push(`  ${p.tool}: ${p.frequency}x (${pct}% success, avg ${avg}ms)`);
      if (p.commonErrors.size > 0) {
        const topErr = [...p.commonErrors.entries()].sort((a, b) => b[1] - a[1])[0];
        lines.push(`    Most common error: ${topErr[0]} (${topErr[1]}x)`);
      }
    }
    lines.push('');
  }

  if (insights.length > 0) {
    const unapplied = insights.filter(i => !i.applied);
    lines.push(`Active insights: ${unapplied.length}`);
    for (const ins of unapplied.slice(0, 5)) {
      lines.push(`  [${ins.category}] ${ins.title}: ${ins.content.slice(0, 80)}`);
    }
    lines.push('');
  }

  if (suggestions.length > 0) {
    lines.push(`Skill suggestions: ${suggestions.length}`);
    for (const s of suggestions.slice(0, 3)) {
      lines.push(`  ${s.name} (priority: ${s.priority}): ${s.content.slice(0, 80)}`);
    }
  }

  return lines.join('\n');
}
