/**
 * Per-session activity tracking.
 *
 * Tracks tool calls, file modifications, and activity history
 * for each session.
 */

export type ActivityType =
  | 'tool_call'
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'bash_command'
  | 'web_fetch'
  | 'web_search'
  | 'subagent'
  | 'skill_load'
  | 'permission_grant'
  | 'permission_deny'
  | 'session_start'
  | 'session_end'
  | 'checkpoint';

export interface ActivityEntry {
  type: ActivityType;
  timestamp: number;
  tool?: string;
  filePath?: string;
  durationMs?: number;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SessionActivity {
  sessionId: string;
  startTime: number;
  endTime?: number;
  entries: ActivityEntry[];
  stats: ActivityStats;
}

export interface ActivityStats {
  totalToolCalls: number;
  totalFileReads: number;
  totalFileWrites: number;
  totalBashCommands: number;
  totalDurationMs: number;
  uniqueFiles: Set<string>;
  toolCounts: Map<string, number>;
}

/**
 * Create a new activity tracker for a session.
 */
export function createActivityTracker(sessionId: string): SessionActivity {
  return {
    sessionId,
    startTime: Date.now(),
    entries: [],
    stats: {
      totalToolCalls: 0,
      totalFileReads: 0,
      totalFileWrites: 0,
      totalBashCommands: 0,
      totalDurationMs: 0,
      uniqueFiles: new Set(),
      toolCounts: new Map(),
    },
  };
}

/**
 * Record an activity entry.
 */
export function recordActivity(
  activity: SessionActivity,
  entry: Omit<ActivityEntry, 'timestamp'>
): void {
  const fullEntry: ActivityEntry = {
    ...entry,
    timestamp: Date.now(),
  };

  activity.entries.push(fullEntry);

  // Update stats
  const stats = activity.stats;

  switch (entry.type) {
    case 'tool_call':
      stats.totalToolCalls++;
      if (entry.tool) {
        stats.toolCounts.set(entry.tool, (stats.toolCounts.get(entry.tool) || 0) + 1);
      }
      break;
    case 'file_read':
      stats.totalFileReads++;
      if (entry.filePath) stats.uniqueFiles.add(entry.filePath);
      break;
    case 'file_write':
    case 'file_edit':
      stats.totalFileWrites++;
      if (entry.filePath) stats.uniqueFiles.add(entry.filePath);
      break;
    case 'bash_command':
      stats.totalBashCommands++;
      break;
  }

  if (entry.durationMs) {
    stats.totalDurationMs += entry.durationMs;
  }
}

/**
 * Get activity summary for a session.
 */
export function getActivitySummary(activity: SessionActivity): {
  duration: number;
  toolCalls: number;
  filesModified: number;
  bashCommands: number;
  topTools: [string, number][];
} {
  const stats = activity.stats;

  // Sort tool counts
  const topTools = Array.from(stats.toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    duration: stats.totalDurationMs,
    toolCalls: stats.totalToolCalls,
    filesModified: stats.totalFileWrites,
    bashCommands: stats.totalBashCommands,
    topTools,
  };
}

/**
 * Get recent activity entries (last N entries).
 */
export function getRecentActivity(
  activity: SessionActivity,
  count: number = 10
): ActivityEntry[] {
  return activity.entries.slice(-count);
}

/**
 * Get activity entries of a specific type.
 */
export function getActivityByType(
  activity: SessionActivity,
  type: ActivityType
): ActivityEntry[] {
  return activity.entries.filter(e => e.type === type);
}

/**
 * Get failed activity entries.
 */
export function getFailedActivity(activity: SessionActivity): ActivityEntry[] {
  return activity.entries.filter(e => e.success === false);
}

/**
 * Serialize activity to JSON (handles Set and Map).
 */
export function serializeActivity(activity: SessionActivity): string {
  const serialized = {
    ...activity,
    stats: {
      ...activity.stats,
      uniqueFiles: Array.from(activity.stats.uniqueFiles),
      toolCounts: Object.fromEntries(activity.stats.toolCounts),
    },
  };
  return JSON.stringify(serialized, null, 2);
}

/**
 * Deserialize activity from JSON.
 */
export function deserializeActivity(json: string): SessionActivity {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    stats: {
      ...parsed.stats,
      uniqueFiles: new Set(parsed.stats.uniqueFiles),
      toolCounts: new Map(Object.entries(parsed.stats.toolCounts)),
    },
  };
}
