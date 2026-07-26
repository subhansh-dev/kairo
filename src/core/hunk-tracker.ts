/**
 * Kairo — Hunk Tracker
 * Track file changes at the hunk level for rollback and conflict detection.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface HunkId {
  id: string;
}

export interface HunkLineInfo {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export type HunkSource =
  | { type: 'agent_edit'; promptIndex: number }
  | { type: 'external'; detected: number }
  | { type: 'merge'; fromBranch: string };

export interface Hunk {
  id: HunkId;
  filePath: string;
  lines: HunkLineInfo;
  source: HunkSource;
  content: string; // the actual diff content
  timestamp: number;
  reverted: boolean;
}

export interface HunkDelta {
  filePath: string;
  hunks: Hunk[];
  baseline: string; // file content before changes
  current: string;  // file content after changes
}

// ─── Hunk Tracker ───────────────────────────────────────────────

export class HunkTracker {
  private hunks = new Map<string, Hunk[]>();
  private baselines = new Map<string, string>();

  /**
   * Record a hunk (file change).
   */
  recordHunk(
    filePath: string,
    lines: HunkLineInfo,
    content: string,
    source: HunkSource,
  ): Hunk {
    const hunk: Hunk = {
      id: { id: generateHunkId() },
      filePath,
      lines,
      source,
      content,
      timestamp: Date.now(),
      reverted: false,
    };

    if (!this.hunks.has(filePath)) {
      this.hunks.set(filePath, []);
    }
    this.hunks.get(filePath)!.push(hunk);

    return hunk;
  }

  /**
   * Save a baseline snapshot of a file.
   */
  saveBaseline(filePath: string, content: string): void {
    this.baselines.set(filePath, content);
  }

  /**
   * Get all hunks for a file.
   */
  getHunks(filePath: string): Hunk[] {
    return this.hunks.get(filePath) || [];
  }

  /**
   * Get all modified files.
   */
  getModifiedFiles(): string[] {
    return [...this.hunks.keys()];
  }

  /**
   * Revert all hunks for a file.
   */
  revertFile(filePath: string): boolean {
    const baseline = this.baselines.get(filePath);
    if (!baseline) return false;

    const hunks = this.hunks.get(filePath);
    if (hunks) {
      for (const hunk of hunks) {
        hunk.reverted = true;
      }
    }

    return true;
  }

  /**
   * Revert all changes.
   */
  revertAll(): Map<string, string> {
    const restored = new Map<string, string>();
    for (const [filePath, baseline] of this.baselines) {
      this.revertFile(filePath);
      restored.set(filePath, baseline);
    }
    return restored;
  }

  /**
   * Generate a unified diff for a file.
   */
  generateDiff(filePath: string): string {
    const baseline = this.baselines.get(filePath);
    const hunks = this.hunks.get(filePath);
    if (!baseline || !hunks || hunks.length === 0) return '';

    const lines = [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
    ];

    for (const hunk of hunks) {
      if (hunk.reverted) continue;
      lines.push(`@@ -${hunk.lines.oldStart},${hunk.lines.oldCount} +${hunk.lines.newStart},${hunk.lines.newCount} @@`);
      lines.push(hunk.content);
    }

    return lines.join('\n');
  }

  /**
   * Get a summary of all changes.
   */
  getSummary(): { files: number; hunks: number; reverted: number } {
    let totalHunks = 0;
    let reverted = 0;
    for (const hunks of this.hunks.values()) {
      totalHunks += hunks.length;
      reverted += hunks.filter(h => h.reverted).length;
    }
    return { files: this.hunks.size, hunks: totalHunks, reverted };
  }
}

function generateHunkId(): string {
  return `hunk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
