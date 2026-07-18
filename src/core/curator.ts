/**
 * Kairo — Curator
 * Background skill maintenance orchestrator.
 * Ported from Hermes Agent's curator.py
 *
 * Periodically reviews skills, removes stale ones, improves based on usage,
 * and creates new skills from successful patterns.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getMostUsedSkills, getStaleSkills, getLearningStats, saveGraph } from './learning-graph.js';
import { getSkillExperience, getSuccessPatterns, getFailurePatterns } from './self-improving-skills.js';
import { getPassRate, getEvidenceSummary } from './verification-evidence.js';

// ─── Types ──────────────────────────────────────────────────────

export interface CuratorReport {
  timestamp: number;
  skillCount: number;
  mostUsedSkills: Array<{ name: string; uses: number }>;
  staleSkills: string[];
  verificationPassRate: number;
  suggestions: string[];
  actions: CuratorAction[];
}

export interface CuratorAction {
  type: 'promote' | 'demote' | 'create' | 'archive' | 'connect';
  skillName: string;
  reason: string;
}

// ─── Curator ────────────────────────────────────────────────────

export class Curator {
  private reportPath: string;

  constructor() {
    this.reportPath = join(homedir(), '.kairo', 'curator-reports');
    if (!existsSync(this.reportPath)) mkdirSync(this.reportPath, { recursive: true });
  }

  /**
   * Run a curation cycle.
   */
  runCuration(): CuratorReport {
    const report: CuratorReport = {
      timestamp: Date.now(),
      skillCount: 0,
      mostUsedSkills: [],
      staleSkills: [],
      verificationPassRate: 1.0,
      suggestions: [],
      actions: [],
    };

    // 1. Gather stats
    const stats = getLearningStats();
    report.skillCount = stats.totalSkillsLearned;

    // 2. Most used skills
    const mostUsed = getMostUsedSkills(10);
    report.mostUsedSkills = mostUsed.map(s => ({ name: s.name, uses: s.useCount }));

    // 3. Stale skills
    const stale = getStaleSkills(30);
    report.staleSkills = stale.map(s => s.name);

    // 4. Verification pass rate
    report.verificationPassRate = getPassRate();

    // 5. Generate suggestions
    report.suggestions = this.generateSuggestions(report);

    // 6. Generate actions
    report.actions = this.generateActions(report);

    // 7. Save report
    this.saveReport(report);

    return report;
  }

  /**
   * Generate suggestions based on current state.
   */
  private generateSuggestions(report: CuratorReport): string[] {
    const suggestions: string[] = [];

    // Suggest archiving stale skills
    if (report.staleSkills.length > 0) {
      suggestions.push(
        `${report.staleSkills.length} skills haven't been used in 30+ days: ${report.staleSkills.slice(0, 5).join(', ')}`
      );
    }

    // Suggest promoting frequently used skills
    const highUse = report.mostUsedSkills.filter(s => s.uses >= 10);
    if (highUse.length > 0) {
      suggestions.push(
        `Consider creating bundles for frequently used skills: ${highUse.map(s => s.name).join(', ')}`
      );
    }

    // Suggest improving low pass rate
    if (report.verificationPassRate < 0.7) {
      suggestions.push(
        `Verification pass rate is ${Math.round(report.verificationPassRate * 100)}%. Review recent failures.`
      );
    }

    // Suggest connecting related skills
    const stats = getLearningStats();
    if (stats.totalPatternsDiscovered > 5 && stats.totalSkillsLearned < 3) {
      suggestions.push('Multiple patterns discovered but few skills created. Consider creating skills from patterns.');
    }

    return suggestions;
  }

  /**
   * Generate recommended actions.
   */
  private generateActions(report: CuratorReport): CuratorAction[] {
    const actions: CuratorAction[] = [];

    // Archive stale skills
    for (const name of report.staleSkills.slice(0, 3)) {
      actions.push({
        type: 'archive',
        skillName: name,
        reason: 'Not used in 30+ days',
      });
    }

    // Promote high-use skills
    for (const skill of report.mostUsedSkills.filter(s => s.uses >= 10)) {
      actions.push({
        type: 'promote',
        skillName: skill.name,
        reason: `Used ${skill.uses} times — consider creating a bundle`,
      });
    }

    return actions;
  }

  /**
   * Save curation report to disk.
   */
  private saveReport(report: CuratorReport): void {
    const filename = `curator-${new Date().toISOString().split('T')[0]}.json`;
    const path = join(this.reportPath, filename);
    writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8');
  }

  /**
   * Load the most recent curation report.
   */
  loadLatestReport(): CuratorReport | null {
    try {
      const { readdirSync } = require('fs');
      const files = readdirSync(this.reportPath)
        .filter((f: string) => f.startsWith('curator-') && f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length === 0) return null;
      return JSON.parse(readFileSync(join(this.reportPath, files[0]), 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Format a curation report for display.
   */
  formatReport(report: CuratorReport): string {
    const lines: string[] = [];
    lines.push('## Curator Report');
    lines.push(`Skills: ${report.skillCount}`);
    lines.push(`Verification: ${Math.round(report.verificationPassRate * 100)}% pass rate`);
    lines.push('');

    if (report.mostUsedSkills.length > 0) {
      lines.push('**Most Used:**');
      for (const s of report.mostUsedSkills.slice(0, 5)) {
        lines.push(`  - ${s.name}: ${s.uses} uses`);
      }
    }

    if (report.suggestions.length > 0) {
      lines.push('');
      lines.push('**Suggestions:**');
      for (const s of report.suggestions) {
        lines.push(`  - ${s}`);
      }
    }

    if (report.actions.length > 0) {
      lines.push('');
      lines.push('**Actions:**');
      for (const a of report.actions) {
        lines.push(`  - [${a.type}] ${a.skillName}: ${a.reason}`);
      }
    }

    return lines.join('\n');
  }
}
