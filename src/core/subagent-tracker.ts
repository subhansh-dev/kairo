/**
 * Kairo — Subagent Tracker
 * Real-time subagent tracking, tree building, and aggregate computation.
 * Ported from Hermes Agent's spawnHistoryStore + subagentTree.
 */

// ─── Types ──────────────────────────────────────────────────────

export type SubagentStatus = 'running' | 'queued' | 'completed' | 'failed' | 'interrupted';

export interface SubagentProgress {
  id: string;
  parentId?: string;
  name: string;
  agent: string;
  status: SubagentStatus;
  depth: number;
  index: number;
  toolCount: number;
  durationSeconds: number;
  inputTokens: number;
  outputTokens: number;
  filesRead: string[];
  filesWritten: string[];
  startedAt: number;
  completedAt?: number;
}

export interface SubagentAggregate {
  totalTools: number;
  totalDuration: number;
  descendantCount: number;
  activeCount: number;
  maxDepthFromHere: number;
  inputTokens: number;
  outputTokens: number;
  filesTouched: number;
  hotness: number; // tools per second
}

export interface SubagentNode {
  item: SubagentProgress;
  children: SubagentNode[];
  aggregate: SubagentAggregate;
}

export interface SubagentStats {
  totalActive: number;
  totalCompleted: number;
  totalFailed: number;
  totalQueued: number;
  totalTools: number;
  totalDuration: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  maxDepth: number;
}

// ─── State ──────────────────────────────────────────────────────

const agents = new Map<string, SubagentProgress>();
let nextIndex = 0;

// ─── Tracking Functions ─────────────────────────────────────────

/**
 * Register a new subagent spawn.
 */
export function trackSubagentSpawn(
  id: string,
  parentId: string | undefined,
  name: string,
  agent: string,
): void {
  const depth = parentId ? getDepth(parentId) + 1 : 0;
  agents.set(id, {
    id,
    parentId,
    name,
    agent,
    status: 'running',
    depth,
    index: nextIndex++,
    toolCount: 0,
    durationSeconds: 0,
    inputTokens: 0,
    outputTokens: 0,
    filesRead: [],
    filesWritten: [],
    startedAt: Date.now(),
  });
}

/**
 * Update subagent progress (tool count, tokens).
 */
export function trackSubagentProgress(
  id: string,
  toolCount: number,
  tokens?: { input?: number; output?: number },
): void {
  const agent = agents.get(id);
  if (!agent) return;
  agent.toolCount = toolCount;
  if (tokens?.input) agent.inputTokens += tokens.input;
  if (tokens?.output) agent.outputTokens += tokens.output;
  agent.durationSeconds = (Date.now() - agent.startedAt) / 1000;
}

/**
 * Track a file read by a subagent.
 */
export function trackSubagentFileRead(id: string, filePath: string): void {
  const agent = agents.get(id);
  if (!agent) return;
  if (!agent.filesRead.includes(filePath)) agent.filesRead.push(filePath);
}

/**
 * Track a file write by a subagent.
 */
export function trackSubagentFileWrite(id: string, filePath: string): void {
  const agent = agents.get(id);
  if (!agent) return;
  if (!agent.filesWritten.includes(filePath)) agent.filesWritten.push(filePath);
}

/**
 * Mark a subagent as completed or failed.
 */
export function trackSubagentComplete(
  id: string,
  status: 'completed' | 'failed' | 'interrupted',
): void {
  const agent = agents.get(id);
  if (!agent) return;
  agent.status = status;
  agent.completedAt = Date.now();
  agent.durationSeconds = (agent.completedAt - agent.startedAt) / 1000;
}

// ─── Tree Building ──────────────────────────────────────────────

function getDepth(id: string): number {
  const agent = agents.get(id);
  return agent?.depth ?? 0;
}

function computeAggregate(node: SubagentNode): SubagentAggregate {
  const { item, children } = node;
  let totalTools = item.toolCount;
  let totalDuration = item.durationSeconds;
  let descendantCount = 0;
  let activeCount = item.status === 'running' ? 1 : 0;
  let maxDepth = 0;
  let inputTokens = item.inputTokens;
  let outputTokens = item.outputTokens;
  const filesSet = new Set<string>([...item.filesRead, ...item.filesWritten]);

  for (const child of children) {
    const ca = child.aggregate;
    totalTools += ca.totalTools;
    totalDuration += ca.totalDuration;
    descendantCount += 1 + ca.descendantCount;
    activeCount += ca.activeCount;
    maxDepth = Math.max(maxDepth, 1 + ca.maxDepthFromHere);
    inputTokens += ca.inputTokens;
    outputTokens += ca.outputTokens;
    for (const f of child.item.filesRead) filesSet.add(f);
    for (const f of child.item.filesWritten) filesSet.add(f);
  }

  const hotness = totalDuration > 0 ? totalTools / totalDuration : 0;

  return {
    totalTools,
    totalDuration,
    descendantCount,
    activeCount,
    maxDepthFromHere: maxDepth,
    inputTokens,
    outputTokens,
    filesTouched: filesSet.size,
    hotness,
  };
}

/**
 * Build the full subagent tree from current flat state.
 */
export function getSubagentTree(): SubagentNode[] {
  const nodeMap = new Map<string, SubagentNode>();

  // Create nodes
  for (const [, agent] of agents) {
    nodeMap.set(agent.id, {
      item: agent,
      children: [],
      aggregate: emptyAggregate(),
    });
  }

  // Wire children
  const roots: SubagentNode[] = [];
  for (const [, node] of nodeMap) {
    if (node.item.parentId && nodeMap.has(node.item.parentId)) {
      nodeMap.get(node.item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Compute aggregates bottom-up
  function aggregateTree(node: SubagentNode): void {
    for (const child of node.children) aggregateTree(child);
    node.aggregate = computeAggregate(node);
  }

  for (const root of roots) aggregateTree(root);

  return roots;
}

function emptyAggregate(): SubagentAggregate {
  return {
    totalTools: 0, totalDuration: 0, descendantCount: 0, activeCount: 0,
    maxDepthFromHere: 0, inputTokens: 0, outputTokens: 0, filesTouched: 0, hotness: 0,
  };
}

// ─── Stats ──────────────────────────────────────────────────────

/**
 * Get summary stats across all tracked subagents.
 */
export function getSubagentStats(): SubagentStats {
  let totalActive = 0, totalCompleted = 0, totalFailed = 0, totalQueued = 0;
  let totalTools = 0, totalDuration = 0;
  let totalInputTokens = 0, totalOutputTokens = 0, maxDepth = 0;

  for (const [, agent] of agents) {
    switch (agent.status) {
      case 'running': totalActive++; break;
      case 'completed': totalCompleted++; break;
      case 'failed': case 'interrupted': totalFailed++; break;
      case 'queued': totalQueued++; break;
    }
    totalTools += agent.toolCount;
    totalDuration += agent.durationSeconds;
    totalInputTokens += agent.inputTokens;
    totalOutputTokens += agent.outputTokens;
    maxDepth = Math.max(maxDepth, agent.depth);
  }

  return {
    totalActive, totalCompleted, totalFailed, totalQueued,
    totalTools, totalDuration, totalInputTokens, totalOutputTokens, maxDepth,
  };
}

/**
 * Get a flat list of all tracked agents (sorted by spawn index).
 */
export function getAllAgents(): SubagentProgress[] {
  return [...agents.values()].sort((a, b) => a.index - b.index);
}

/**
 * Get a specific agent by id.
 */
export function getAgent(id: string): SubagentProgress | undefined {
  return agents.get(id);
}

// ─── Sparkline ──────────────────────────────────────────────────

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

/**
 * Build a sparkline string showing depth distribution.
 * Each character represents a depth level, height = count of agents at that depth.
 */
export function buildSparkline(tree: SubagentNode[]): string {
  const depthCounts = new Map<number, number>();

  function walk(nodes: SubagentNode[]): void {
    for (const node of nodes) {
      const d = node.item.depth;
      depthCounts.set(d, (depthCounts.get(d) || 0) + 1);
      walk(node.children);
    }
  }
  walk(tree);

  if (depthCounts.size === 0) return '';

  const maxD = Math.max(...depthCounts.keys());
  const maxC = Math.max(...depthCounts.values(), 1);

  let spark = '';
  for (let d = 0; d <= maxD; d++) {
    const count = depthCounts.get(d) || 0;
    const idx = Math.round((count / maxC) * (SPARK_CHARS.length - 1));
    spark += SPARK_CHARS[idx];
  }
  return spark;
}

// ─── Formatting ─────────────────────────────────────────────────

/**
 * Format duration in seconds to human readable string.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m${s}s`;
}

/**
 * Format token count to human readable string.
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/**
 * Reset all tracking state (for testing).
 */
export function resetSubagentTracker(): void {
  agents.clear();
  nextIndex = 0;
}
