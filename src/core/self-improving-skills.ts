/**
 * Kairo — Self-Improving Skills
 * Skills that learn and improve during use.
 * Inspired by Hermes Agent's learning_mutations.py
 *
 * When a skill is used and the task succeeds, the skill records what worked.
 * When a skill is used and the task fails, the skill records what to avoid.
 * Over time, skills accumulate experience that makes them more effective.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SKILLS_DIR = join(homedir(), '.kairo', 'skills');
const MUTATIONS_DIR = join(homedir(), '.kairo', 'skill-mutations');

// ─── Types ──────────────────────────────────────────────────────

export interface SkillMutation {
  skillName: string;
  type: 'success' | 'failure' | 'preference' | 'convention';
  description: string;
  context: string;
  timestamp: number;
  taskHash?: string;
}

export interface SkillExperience {
  skillName: string;
  totalUses: number;
  successes: number;
  failures: number;
  mutations: SkillMutation[];
  lastImproved: number;
  confidence: number; // 0-1
}

// ─── Experience Tracking ────────────────────────────────────────

let experiences: Map<string, SkillExperience> | null = null;

function ensureDir(): void {
  if (!existsSync(MUTATIONS_DIR)) mkdirSync(MUTATIONS_DIR, { recursive: true });
}

function getExperiences(): Map<string, SkillExperience> {
  if (experiences) return experiences;
  experiences = new Map();
  ensureDir();

  // Load from disk
  const { readdirSync } = require('fs');
  try {
    for (const entry of readdirSync(MUTATIONS_DIR)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(MUTATIONS_DIR, entry), 'utf-8'));
        experiences.set(data.skillName, data);
      } catch {}
    }
  } catch {}

  return experiences;
}

function saveExperience(exp: SkillExperience): void {
  ensureDir();
  const path = join(MUTATIONS_DIR, `${exp.skillName}.json`);
  writeFileSync(path, JSON.stringify(exp, null, 2), 'utf-8');
}

// ─── Recording Mutations ────────────────────────────────────────

export function recordSuccess(skillName: string, context: string, description: string): void {
  const exp = getExperience(skillName);
  exp.totalUses++;
  exp.successes++;
  exp.confidence = exp.successes / exp.totalUses;
  exp.lastImproved = Date.now();

  exp.mutations.push({
    skillName,
    type: 'success',
    description,
    context,
    timestamp: Date.now(),
  });

  // Keep only last 50 mutations
  if (exp.mutations.length > 50) {
    exp.mutations = exp.mutations.slice(-50);
  }

  saveExperience(exp);
}

export function recordFailure(skillName: string, context: string, description: string): void {
  const exp = getExperience(skillName);
  exp.totalUses++;
  exp.failures++;
  exp.confidence = exp.successes / exp.totalUses;
  exp.lastImproved = Date.now();

  exp.mutations.push({
    skillName,
    type: 'failure',
    description,
    context,
    timestamp: Date.now(),
  });

  if (exp.mutations.length > 50) {
    exp.mutations = exp.mutations.slice(-50);
  }

  saveExperience(exp);
}

export function recordPreference(skillName: string, context: string, preference: string): void {
  const exp = getExperience(skillName);
  exp.mutations.push({
    skillName,
    type: 'preference',
    description: preference,
    context,
    timestamp: Date.now(),
  });

  if (exp.mutations.length > 50) {
    exp.mutations = exp.mutations.slice(-50);
  }

  saveExperience(exp);
}

export function recordConvention(skillName: string, context: string, convention: string): void {
  const exp = getExperience(skillName);
  exp.mutations.push({
    skillName,
    type: 'convention',
    description: convention,
    context,
    timestamp: Date.now(),
  });

  if (exp.mutations.length > 50) {
    exp.mutations = exp.mutations.slice(-50);
  }

  saveExperience(exp);
}

// ─── Querying Experience ────────────────────────────────────────

function getExperience(skillName: string): SkillExperience {
  const exps = getExperiences();
  let exp = exps.get(skillName);
  if (!exp) {
    exp = {
      skillName,
      totalUses: 0,
      successes: 0,
      failures: 0,
      mutations: [],
      lastImproved: 0,
      confidence: 0.5,
    };
    exps.set(skillName, exp);
  }
  return exp;
}

export function getSkillExperience(skillName: string): SkillExperience {
  return getExperience(skillName);
}

export function getSkillConfidence(skillName: string): number {
  return getExperience(skillName).confidence;
}

export function getRecentMutations(skillName: string, limit: number = 10): SkillMutation[] {
  return getExperience(skillName).mutations.slice(-limit);
}

export function getSuccessPatterns(skillName: string): SkillMutation[] {
  return getExperience(skillName).mutations.filter(m => m.type === 'success');
}

export function getFailurePatterns(skillName: string): SkillMutation[] {
  return getExperience(skillName).mutations.filter(m => m.type === 'failure');
}

// ─── Skill Improvement ──────────────────────────────────────────

export function buildExperiencePrompt(skillName: string): string {
  const exp = getExperience(skillName);
  if (exp.totalUses === 0) return '';

  const lines: string[] = [];
  lines.push(`## ${skillName} — Experience (${exp.totalUses} uses, ${Math.round(exp.confidence * 100)}% success)`);

  // Recent successes
  const successes = exp.mutations.filter(m => m.type === 'success').slice(-3);
  if (successes.length > 0) {
    lines.push('');
    lines.push('**What worked:**');
    for (const s of successes) {
      lines.push(`- ${s.description}`);
    }
  }

  // Recent failures
  const failures = exp.mutations.filter(m => m.type === 'failure').slice(-3);
  if (failures.length > 0) {
    lines.push('');
    lines.push('**What to avoid:**');
    for (const f of failures) {
      lines.push(`- ${f.description}`);
    }
  }

  // Preferences
  const prefs = exp.mutations.filter(m => m.type === 'preference').slice(-3);
  if (prefs.length > 0) {
    lines.push('');
    lines.push('**User preferences:**');
    for (const p of prefs) {
      lines.push(`- ${p.description}`);
    }
  }

  // Conventions
  const convs = exp.mutations.filter(m => m.type === 'convention').slice(-3);
  if (convs.length > 0) {
    lines.push('');
    lines.push('**Project conventions:**');
    for (const c of convs) {
      lines.push(`- ${c.description}`);
    }
  }

  return lines.join('\n');
}

// ─── Auto-Learning ──────────────────────────────────────────────

export function extractLearnings(taskDescription: string, result: string, success: boolean): SkillMutation[] {
  const mutations: SkillMutation[] = [];

  // Extract patterns from the result
  if (success) {
    // Look for what was done successfully
    const fileMatches = result.match(/(?:created|modified|wrote|edited)\s+[`']?([^\s`']+)[`']?/gi);
    if (fileMatches) {
      mutations.push({
        skillName: 'auto',
        type: 'success',
        description: `Successfully ${fileMatches.join(', ')}`,
        context: taskDescription.slice(0, 200),
        timestamp: Date.now(),
      });
    }
  } else {
    // Look for what failed
    const errorMatches = result.match(/(?:error|failed|couldn't|unable)\s*:?\s*(.+)/gi);
    if (errorMatches) {
      mutations.push({
        skillName: 'auto',
        type: 'failure',
        description: `Failed: ${errorMatches[0].slice(0, 100)}`,
        context: taskDescription.slice(0, 200),
        timestamp: Date.now(),
      });
    }
  }

  return mutations;
}
