/**
 * Kairo — Insights Engine
 * Analyze session data for usage insights.
 * Ported from Hermes Agent's insights.py
 */

import { getPassRate, getEvidenceSummary } from './verification-evidence.js';
import { getLearningStats, getMostUsedSkills } from './learning-graph.js';

// ─── Types ──────────────────────────────────────────────────────

export interface InsightReport {
  timestamp: number;
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  toolUsage: Record<string, { calls: number; successes: number; failures: number }>;
  modelUsage: Record<string, { calls: number; tokens: number }>;
  verificationPassRate: number;
  topSkills: Array<{ name: string; uses: number }>;
  suggestions: string[];
}

// ─── Engine ─────────────────────────────────────────────────────

export class InsightsEngine {
  private toolUsage = new Map<string, { calls: number; successes: number; failures: number }>();
  private modelUsage = new Map<string, { calls: number; tokens: number }>();
  private totalTokens = 0;
  private totalCost = 0;
  private sessionCount = 0;

  /**
   * Record a tool call for insights.
   */
  recordToolCall(toolName: string, success: boolean): void {
    let entry = this.toolUsage.get(toolName);
    if (!entry) {
      entry = { calls: 0, successes: 0, failures: 0 };
      this.toolUsage.set(toolName, entry);
    }
    entry.calls++;
    if (success) entry.successes++;
    else entry.failures++;
  }

  /**
   * Record a model call for insights.
   */
  recordModelCall(modelId: string, tokens: number): void {
    let entry = this.modelUsage.get(modelId);
    if (!entry) {
      entry = { calls: 0, tokens: 0 };
      this.modelUsage.set(modelId, entry);
    }
    entry.calls++;
    entry.tokens += tokens;
    this.totalTokens += tokens;
  }

  /**
   * Record cost.
   */
  recordCost(usd: number): void {
    this.totalCost += usd;
  }

  /**
   * Increment session count.
   */
  recordSession(): void {
    this.sessionCount++;
  }

  /**
   * Generate an insight report.
   */
  generate(): InsightReport {
    const learningStats = getLearningStats();
    const topSkills = getMostUsedSkills(5);

    return {
      timestamp: Date.now(),
      sessionCount: this.sessionCount,
      totalTokens: this.totalTokens,
      totalCostUsd: this.totalCost,
      toolUsage: Object.fromEntries(this.toolUsage),
      modelUsage: Object.fromEntries(this.modelUsage),
      verificationPassRate: getPassRate(),
      topSkills: topSkills.map(s => ({ name: s.name, uses: s.useCount })),
      suggestions: this.generateSuggestions(),
    };
  }

  private generateSuggestions(): string[] {
    const suggestions: string[] = [];

    // Suggest based on tool usage
    for (const [tool, stats] of this.toolUsage) {
      const failRate = stats.failures / stats.calls;
      if (failRate > 0.3 && stats.calls >= 3) {
        suggestions.push(`Tool "${tool}" has ${Math.round(failRate * 100)}% failure rate — check usage patterns`);
      }
    }

    // Suggest based on model usage
    for (const [model, stats] of this.modelUsage) {
      if (stats.calls > 10 && stats.tokens / stats.calls > 5000) {
        suggestions.push(`Model "${model}" averaging ${Math.round(stats.tokens / stats.calls)} tokens/call — consider using a smaller model for simple tasks`);
      }
    }

    return suggestions;
  }

  /**
   * Format report for terminal display.
   */
  formatTerminal(report: InsightReport): string {
    const lines: string[] = [];
    lines.push('## Session Insights');
    lines.push('');
    lines.push(`Sessions: ${report.sessionCount}`);
    lines.push(`Total tokens: ${report.totalTokens.toLocaleString()}`);
    lines.push(`Total cost: $${report.totalCostUsd.toFixed(4)}`);
    lines.push(`Verification: ${Math.round(report.verificationPassRate * 100)}% pass rate`);
    lines.push('');

    if (Object.keys(report.toolUsage).length > 0) {
      lines.push('**Tool Usage:**');
      const sorted = Object.entries(report.toolUsage).sort((a, b) => b[1].calls - a[1].calls);
      for (const [tool, stats] of sorted.slice(0, 10)) {
        const rate = Math.round((stats.successes / stats.calls) * 100);
        lines.push(`  ${tool}: ${stats.calls} calls (${rate}% success)`);
      }
      lines.push('');
    }

    if (report.topSkills.length > 0) {
      lines.push('**Top Skills:**');
      for (const skill of report.topSkills) {
        lines.push(`  ${skill.name}: ${skill.uses} uses`);
      }
      lines.push('');
    }

    if (report.suggestions.length > 0) {
      lines.push('**Suggestions:**');
      for (const s of report.suggestions) {
        lines.push(`  - ${s}`);
      }
    }

    return lines.join('\n');
  }
}
