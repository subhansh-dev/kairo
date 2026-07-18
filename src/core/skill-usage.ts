/**
 * Skill usage — track skill usage statistics.
 */

export interface SkillUsageEntry {
  skillName: string;
  usedAt: number;
  sessionId?: string;
  turnNumber?: number;
}

// Skill usage history
const usageHistory: SkillUsageEntry[] = [];
const MAX_HISTORY = 1000;

/**
 * Record skill usage.
 */
export function recordSkillUsage(entry: SkillUsageEntry): void {
  usageHistory.push(entry);
  if (usageHistory.length > MAX_HISTORY) {
    usageHistory.splice(0, usageHistory.length - MAX_HISTORY);
  }
}

/**
 * Get skill usage history.
 */
export function getSkillUsageHistory(limit = 50): SkillUsageEntry[] {
  return usageHistory.slice(-limit);
}

/**
 * Get most used skills.
 */
export function getMostUsedSkills(limit = 10): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of usageHistory) {
    counts.set(entry.skillName, (counts.get(entry.skillName) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get recently used skills.
 */
export function getRecentlyUsedSkills(limit = 10): string[] {
  const seen = new Set<string>();
  const recent: string[] = [];
  for (let i = usageHistory.length - 1; i >= 0 && recent.length < limit; i--) {
    const name = usageHistory[i].skillName;
    if (!seen.has(name)) {
      seen.add(name);
      recent.push(name);
    }
  }
  return recent;
}

/**
 * Clear usage history.
 */
export function clearSkillUsageHistory(): void {
  usageHistory.length = 0;
}
