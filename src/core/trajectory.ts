/**
 * Trajectory — trajectory recording and management.
 */

export interface TrajectoryEntry {
  timestamp: number;
  type: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  durationMs?: number;
}

export interface Trajectory {
  sessionId: string;
  entries: TrajectoryEntry[];
  startedAt: number;
  endedAt?: number;
}

/**
 * Create a new trajectory.
 */
export function createTrajectory(sessionId: string): Trajectory {
  return {
    sessionId,
    entries: [],
    startedAt: Date.now(),
  };
}

/**
 * Add an entry to a trajectory.
 */
export function addTrajectoryEntry(trajectory: Trajectory, entry: Omit<TrajectoryEntry, 'timestamp'>): void {
  trajectory.entries.push({ ...entry, timestamp: Date.now() });
}

/**
 * Convert a trajectory to a saveable format.
 */
export function serializeTrajectory(trajectory: Trajectory): string {
  return JSON.stringify(trajectory, null, 2);
}

/**
 * Load a trajectory from a string.
 */
export function deserializeTrajectory(data: string): Trajectory | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Get trajectory statistics.
 */
export function getTrajectoryStats(trajectory: Trajectory): {
  totalEntries: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  duration: number;
} {
  return {
    totalEntries: trajectory.entries.length,
    userMessages: trajectory.entries.filter(e => e.type === 'user').length,
    assistantMessages: trajectory.entries.filter(e => e.type === 'assistant').length,
    toolCalls: trajectory.entries.filter(e => e.type === 'tool').length,
    duration: (trajectory.endedAt || Date.now()) - trajectory.startedAt,
  };
}

/**
 * Convert scratchpad content to thinking format.
 */
export function convertScratchpadToThink(content: string): string {
  if (!content) return content;
  if (content.includes('<think>') || content.includes('<thinking>')) return content;
  return `<think>\n${content}\n</think>`;
}
