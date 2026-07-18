/**
 * Kairo — Learning Graph
 * Tracks what the agent learns over time: skills used, patterns discovered,
 * user preferences, project conventions.
 * Inspired by Hermes Agent's learning_graph.py
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const GRAPH_PATH = join(homedir(), '.kairo', 'learning-graph.json');

// ─── Types ──────────────────────────────────────────────────────

export interface SkillNode {
  name: string;
  category: string;
  source: 'learned' | 'profile' | 'system';
  useCount: number;
  lastUsed: number;
  state: 'active' | 'dormant' | 'deprecated';
  related: string[];
  createdFrom?: string; // task that created this skill
}

export interface MemoryNode {
  key: string;
  value: string;
  category: string;
  created: number;
  lastAccessed: number;
  accessCount: number;
  relatedSkills: string[];
}

export interface PatternNode {
  pattern: string;
  description: string;
  frequency: number;
  lastSeen: number;
  examples: string[];
}

export interface LearningGraph {
  skills: Map<string, SkillNode>;
  memories: Map<string, MemoryNode>;
  patterns: Map<string, PatternNode>;
  edges: Map<string, string[]>; // adjacency list
  stats: {
    totalSkillsLearned: number;
    totalPatternsDiscovered: number;
    totalMemories: number;
    sessionsActive: number;
  };
}

// ─── Graph Implementation ───────────────────────────────────────

let graph: LearningGraph | null = null;

function getGraph(): LearningGraph {
  if (!graph) {
    graph = loadGraph();
  }
  return graph;
}

function loadGraph(): LearningGraph {
  const g: LearningGraph = {
    skills: new Map(),
    memories: new Map(),
    patterns: new Map(),
    edges: new Map(),
    stats: { totalSkillsLearned: 0, totalPatternsDiscovered: 0, totalMemories: 0, sessionsActive: 0 },
  };

  if (!existsSync(GRAPH_PATH)) return g;

  try {
    const raw = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
    for (const [k, v] of Object.entries(raw.skills || {})) g.skills.set(k, v as SkillNode);
    for (const [k, v] of Object.entries(raw.memories || {})) g.memories.set(k, v as MemoryNode);
    for (const [k, v] of Object.entries(raw.patterns || {})) g.patterns.set(k, v as PatternNode);
    for (const [k, v] of Object.entries(raw.edges || {})) g.edges.set(k, v as string[]);
    g.stats = raw.stats || g.stats;
  } catch {}

  return g;
}

export function saveGraph(): void {
  if (!graph) return;
  const dir = join(homedir(), '.kairo');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const serializable = {
    skills: Object.fromEntries(graph.skills),
    memories: Object.fromEntries(graph.memories),
    patterns: Object.fromEntries(graph.patterns),
    edges: Object.fromEntries(graph.edges),
    stats: graph.stats,
  };

  writeFileSync(GRAPH_PATH, JSON.stringify(serializable, null, 2), 'utf-8');
}

// ─── Skill Tracking ─────────────────────────────────────────────

export function recordSkillUse(skillName: string, category: string = 'general'): void {
  const g = getGraph();
  let node = g.skills.get(skillName);

  if (!node) {
    node = {
      name: skillName,
      category,
      source: 'learned',
      useCount: 0,
      lastUsed: 0,
      state: 'active',
      related: [],
    };
    g.skills.set(skillName, node);
    g.stats.totalSkillsLearned++;
  }

  node.useCount++;
  node.lastUsed = Date.now();
  node.state = 'active';
}

export function recordSkillCreation(skillName: string, fromTask: string, related: string[] = []): void {
  const g = getGraph();
  g.skills.set(skillName, {
    name: skillName,
    category: 'learned',
    source: 'learned',
    useCount: 1,
    lastUsed: Date.now(),
    state: 'active',
    related,
    createdFrom: fromTask,
  });
  g.stats.totalSkillsLearned++;

  // Create edges to related skills
  for (const rel of related) {
    addEdge(skillName, rel);
  }
}

// ─── Memory Tracking ────────────────────────────────────────────

export function recordMemoryAccess(key: string): void {
  const g = getGraph();
  const node = g.memories.get(key);
  if (node) {
    node.lastAccessed = Date.now();
    node.accessCount++;
  }
}

export function addMemoryNode(key: string, value: string, category: string = 'general'): void {
  const g = getGraph();
  g.memories.set(key, {
    key,
    value,
    category,
    created: Date.now(),
    lastAccessed: Date.now(),
    accessCount: 1,
    relatedSkills: [],
  });
  g.stats.totalMemories++;
}

// ─── Pattern Tracking ───────────────────────────────────────────

export function recordPattern(pattern: string, description: string, example: string = ''): void {
  const g = getGraph();
  let node = g.patterns.get(pattern);

  if (!node) {
    node = {
      pattern,
      description,
      frequency: 0,
      lastSeen: 0,
      examples: [],
    };
    g.patterns.set(pattern, node);
    g.stats.totalPatternsDiscovered++;
  }

  node.frequency++;
  node.lastSeen = Date.now();
  if (example && !node.examples.includes(example)) {
    node.examples.push(example);
    if (node.examples.length > 5) node.examples.shift();
  }
}

// ─── Graph Edges ────────────────────────────────────────────────

export function addEdge(from: string, to: string): void {
  const g = getGraph();
  if (!g.edges.has(from)) g.edges.set(from, []);
  if (!g.edges.has(to)) g.edges.set(to, []);

  const fromEdges = g.edges.get(from)!;
  if (!fromEdges.includes(to)) fromEdges.push(to);

  const toEdges = g.edges.get(to)!;
  if (!toEdges.includes(from)) toEdges.push(from);
}

export function getRelated(nodeName: string): string[] {
  return getGraph().edges.get(nodeName) || [];
}

// ─── Queries ────────────────────────────────────────────────────

export function getMostUsedSkills(limit: number = 10): SkillNode[] {
  return [...getGraph().skills.values()]
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, limit);
}

export function getRecentPatterns(limit: number = 10): PatternNode[] {
  return [...getGraph().patterns.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

export function getStaleSkills(days: number = 30): SkillNode[] {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  return [...getGraph().skills.values()]
    .filter(s => s.lastUsed < cutoff && s.state === 'active');
}

export function getLearningStats(): LearningGraph['stats'] {
  return { ...getGraph().stats };
}

// ─── Auto-Improvement ───────────────────────────────────────────

export function suggestImprovements(): string[] {
  const g = getGraph();
  const suggestions: string[] = [];

  // Suggest creating skills for frequently used patterns
  for (const pattern of g.patterns.values()) {
    if (pattern.frequency >= 3 && !g.skills.has(pattern.pattern)) {
      suggestions.push(`Pattern "${pattern.description}" seen ${pattern.frequency} times — consider creating a skill.`);
    }
  }

  // Suggest deactivating stale skills
  const stale = getStaleSkills(30);
  if (stale.length > 0) {
    suggestions.push(`${stale.length} skills haven't been used in 30+ days: ${stale.map(s => s.name).join(', ')}`);
  }

  // Suggest connecting related skills
  for (const skill of g.skills.values()) {
    if (skill.useCount >= 5 && skill.related.length === 0) {
      suggestions.push(`Skill "${skill.name}" used ${skill.useCount} times but has no related skills defined.`);
    }
  }

  return suggestions;
}

// ─── Nudge (periodic learning check) ────────────────────────────

export function learningNudge(): string | null {
  const suggestions = suggestImprovements();
  if (suggestions.length === 0) return null;
  return `[Learning] ${suggestions[0]}`;
}
