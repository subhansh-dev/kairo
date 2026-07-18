/**
 * Kairo — Learning Graph Render
 * Terminal renderer for the learning timeline.
 * Ported from Hermes Agent's learning_graph_render.py
 */

import { getMostUsedSkills, getRecentPatterns, getLearningStats } from './learning-graph.js';
import { getSkillExperience } from './self-improving-skills.js';

// ─── Types ──────────────────────────────────────────────────────

interface TimelineEntry {
  date: string;
  skills: number;
  patterns: number;
  memories: number;
}

// ─── Rendering ──────────────────────────────────────────────────

/**
 * Render a learning timeline as a terminal bar chart.
 */
export function renderLearningTimeline(): string {
  const stats = getLearningStats();
  const mostUsed = getMostUsedSkills(10);
  const patterns = getRecentPatterns(5);

  const lines: string[] = [];
  lines.push('╔══════════════════════════════════════════╗');
  lines.push('║         LEARNING TIMELINE                ║');
  lines.push('╚══════════════════════════════════════════╝');
  lines.push('');

  // Stats
  lines.push(`Skills learned:    ${stats.totalSkillsLearned}`);
  lines.push(`Patterns found:    ${stats.totalPatternsDiscovered}`);
  lines.push(`Memories stored:   ${stats.totalMemories}`);
  lines.push('');

  // Most used skills bar chart
  if (mostUsed.length > 0) {
    lines.push('┌─ Most Used Skills ─────────────────────┐');
    const maxUses = Math.max(...mostUsed.map(s => s.useCount));
    for (const skill of mostUsed) {
      const barLen = Math.round((skill.useCount / maxUses) * 20);
      const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
      const confidence = getSkillConfidence(skill.name);
      lines.push(`│ ${skill.name.padEnd(20)} ${bar} ${String(skill.useCount).padStart(3)}x (${Math.round(confidence * 100)}%)`);
    }
    lines.push('└────────────────────────────────────────┘');
    lines.push('');
  }

  // Recent patterns
  if (patterns.length > 0) {
    lines.push('┌─ Recent Patterns ──────────────────────┐');
    for (const p of patterns) {
      const age = formatAge(p.lastSeen);
      lines.push(`│ ${p.description.slice(0, 35).padEnd(35)} ${String(p.frequency).padStart(3)}x ${age}`);
    }
    lines.push('└────────────────────────────────────────┘');
  }

  return lines.join('\n');
}

function getSkillConfidence(name: string): number {
  try {
    const exp = getSkillExperience(name);
    return exp.confidence;
  } catch {
    return 0.5;
  }
}

function formatAge(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  if (ageMs < 60000) return 'just now';
  if (ageMs < 3600000) return `${Math.floor(ageMs / 60000)}m ago`;
  if (ageMs < 86400000) return `${Math.floor(ageMs / 3600000)}h ago`;
  return `${Math.floor(ageMs / 86400000)}d ago`;
}
