/**
 * Kairo — Agent Overlay Panel
 * Full-screen overlay showing subagent tree with status, stats, and keyboard navigation.
 * Ported from Hermes Agent's agentsOverlay.
 */

import type { Component } from './components.js';
import {
  type SubagentNode,
  type SubagentProgress,
  type SubagentStats,
  getSubagentTree,
  getSubagentStats,
  getAllAgents,
  formatDuration,
  formatTokens,
  buildSparkline,
} from '../core/subagent-tracker.js';

// ─── Theme ──────────────────────────────────────────────────────

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const c = {
  primary: '\x1b[38;2;0;204;204m',
  accent: '\x1b[38;2;215;119;87m',
  success: '\x1b[38;2;78;186;101m',
  warning: '\x1b[38;2;255;193;7m',
  error: '\x1b[38;2;255;107;128m',
  muted: '\x1b[38;2;153;153;153m',
  subtle: '\x1b[38;2;80;80;80m',
  text: '\x1b[38;2;230;230;230m',
  surface: '\x1b[38;2;60;60;68m',
};

// ─── Status Glyphs ──────────────────────────────────────────────

const STATUS_GLYPH: Record<string, string> = {
  running: `${c.warning}●${R}`,
  completed: `${c.success}✓${R}`,
  failed: `${c.error}✗${R}`,
  interrupted: `${c.error}⊘${R}`,
  queued: `${c.muted}○${R}`,
};

// ─── Sort Modes ─────────────────────────────────────────────────

type SortMode = 'spawn' | 'busiest' | 'slowest' | 'status';

const SORT_LABELS: Record<SortMode, string> = {
  spawn: 'Spawn Order',
  busiest: 'Busiest',
  slowest: 'Slowest',
  status: 'By Status',
};

// ─── Filter Modes ───────────────────────────────────────────────

type FilterMode = 'all' | 'running' | 'failed' | 'leaves';

const FILTER_LABELS: Record<FilterMode, string> = {
  all: 'All',
  running: 'Running',
  failed: 'Failed',
  leaves: 'Leaves',
};

// ─── Hotness Color ──────────────────────────────────────────────

function hotnessColor(toolsPerSec: number): string {
  if (toolsPerSec >= 2) return '\x1b[38;2;255;60;60m';   // hot red
  if (toolsPerSec >= 1) return '\x1b[38;2;255;165;0m';  // orange
  if (toolsPerSec >= 0.5) return '\x1b[38;2;255;255;0m'; // yellow
  if (toolsPerSec >= 0.1) return '\x1b[38;2;0;200;200m'; // cyan
  return '\x1b[38;2;100;100;180m'; // cold blue
}

// ─── Overlay Component ──────────────────────────────────────────

export class AgentOverlayComponent implements Component {
  children: Component[] = [];
  private visible = false;
  private selectedIndex = 0;
  private sortMode: SortMode = 'spawn';
  private filterMode: FilterMode = 'all';
  private flatNodes: FlatNode[] = [];

  constructor() {}

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) this.refresh();
  }

  show(): void {
    this.visible = true;
    this.refresh();
  }

  hide(): void {
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  handleInput(char: string): void {
    if (!this.visible) return;

    switch (char) {
      case 'q':
      case '\x1b': // ESC
        this.hide();
        return;
      case 'j':
      case '\x1b[B': // Down
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.flatNodes.length - 1);
        return;
      case 'k':
      case '\x1b[A': // Up
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        return;
      case 's':
        this.cycleSort();
        return;
      case 'f':
        this.cycleFilter();
        return;
      case 'g':
        this.selectedIndex = 0;
        return;
      case 'G':
        this.selectedIndex = Math.max(0, this.flatNodes.length - 1);
        return;
      case 'r':
        this.refresh();
        return;
    }
  }

  private cycleSort(): void {
    const modes: SortMode[] = ['spawn', 'busiest', 'slowest', 'status'];
    const idx = modes.indexOf(this.sortMode);
    this.sortMode = modes[(idx + 1) % modes.length];
    this.refresh();
  }

  private cycleFilter(): void {
    const modes: FilterMode[] = ['all', 'running', 'failed', 'leaves'];
    const idx = modes.indexOf(this.filterMode);
    this.filterMode = modes[(idx + 1) % modes.length];
    this.selectedIndex = 0;
    this.refresh();
  }

  private refresh(): void {
    const tree = getSubagentTree();
    this.flatNodes = flattenTree(tree, this.sortMode, this.filterMode);
    if (this.selectedIndex >= this.flatNodes.length) {
      this.selectedIndex = Math.max(0, this.flatNodes.length - 1);
    }
  }

  render(width: number): string[] {
    if (!this.visible) return [];

    const lines: string[] = [];
    const innerW = width - 4;

    // Title bar
    const stats = getSubagentStats();
    const title = 'Agent Monitor';
    const titleBar = `${c.primary}${B}╭─ ${title} ${'─'.repeat(Math.max(0, innerW - title.length - 3))}╮${R}`;
    lines.push(titleBar);

    // Stats row
    const spark = buildSparkline(getSubagentTree());
    const statsLine = formatStatsRow(stats, spark, innerW);
    lines.push(`  ${c.subtle}│${R} ${statsLine}`);

    // Controls
    const controls = `${D}j/k${R} nav  ${D}s${R} sort:${SORT_LABELS[this.sortMode]}  ${D}f${R} filter:${FILTER_LABELS[this.filterMode]}  ${D}q${R} close`;
    lines.push(`  ${c.subtle}│${R} ${controls}`);

    // Separator
    lines.push(`  ${c.subtle}│${R}${'─'.repeat(innerW - 1)}`);

    // Tree
    if (this.flatNodes.length === 0) {
      lines.push(`  ${c.subtle}│${R} ${D}${c.muted}No subagents tracked.${R}`);
    } else {
      const maxVisible = Math.max(5, 20); // reasonable default
      const start = Math.max(0, this.selectedIndex - maxVisible + 2);
      const end = Math.min(this.flatNodes.length, start + maxVisible);

      for (let i = start; i < end; i++) {
        const node = this.flatNodes[i];
        const selected = i === this.selectedIndex;
        const line = formatTreeNode(node, selected, innerW);
        lines.push(`  ${c.subtle}│${R} ${line}`);
      }

      if (end < this.flatNodes.length) {
        lines.push(`  ${c.subtle}│${R} ${D}${c.muted}... +${this.flatNodes.length - end} more${R}`);
      }
    }

    // Selected agent detail
    if (this.flatNodes.length > 0 && this.selectedIndex < this.flatNodes.length) {
      lines.push(`  ${c.subtle}│${R}${'─'.repeat(innerW - 1)}`);
      const detail = formatAgentDetail(this.flatNodes[this.selectedIndex].node, innerW);
      for (const l of detail) {
        lines.push(`  ${c.subtle}│${R} ${l}`);
      }
    }

    // Footer
    lines.push(`  ${c.subtle}╰${'─'.repeat(innerW - 1)}╯${R}`);

    return lines;
  }
}

// ─── Flatten & Sort ─────────────────────────────────────────────

interface FlatNode {
  node: SubagentNode;
  depth: number;
}

function flattenTree(
  roots: SubagentNode[],
  sort: SortMode,
  filter: FilterMode,
): FlatNode[] {
  const all: FlatNode[] = [];

  function walk(nodes: SubagentNode[], depth: number): void {
    // Sort children
    let sorted = [...nodes];
    switch (sort) {
      case 'busiest':
        sorted.sort((a, b) => b.aggregate.totalTools - a.aggregate.totalTools);
        break;
      case 'slowest':
        sorted.sort((a, b) => b.aggregate.totalDuration - a.aggregate.totalDuration);
        break;
      case 'status':
        sorted.sort((a, b) => {
          const order: Record<string, number> = { running: 0, queued: 1, failed: 2, interrupted: 3, completed: 4 };
          return (order[a.item.status] ?? 5) - (order[b.item.status] ?? 5);
        });
        break;
      // spawn = default order (index)
    }

    for (const node of sorted) {
      // Apply filter
      if (filter === 'running' && node.item.status !== 'running') continue;
      if (filter === 'failed' && node.item.status !== 'failed' && node.item.status !== 'interrupted') continue;
      if (filter === 'leaves' && node.children.length > 0) continue;

      all.push({ node, depth });
      walk(node.children, depth + 1);
    }
  }

  walk(roots, 0);
  return all;
}

// ─── Formatting ─────────────────────────────────────────────────

function formatStatsRow(stats: SubagentStats, spark: string, width: number): string {
  const parts: string[] = [];
  if (stats.totalActive > 0) parts.push(`${c.warning}${B}${stats.totalActive}●${R}`);
  if (stats.totalCompleted > 0) parts.push(`${c.success}${stats.totalCompleted}✓${R}`);
  if (stats.totalFailed > 0) parts.push(`${c.error}${stats.totalFailed}✗${R}`);
  parts.push(`${c.muted}${stats.totalTools} tools${R}`);
  parts.push(`${c.muted}${formatDuration(stats.totalDuration)}${R}`);
  if (spark) parts.push(`${c.primary}${spark}${R}`);
  return parts.join(` ${c.muted}·${R} `);
}

function formatTreeNode(flat: FlatNode, selected: boolean, _width: number): string {
  const { node, depth } = flat;
  const indent = '  '.repeat(depth);
  const glyph = STATUS_GLYPH[node.item.status] || '?';
  const prefix = selected ? `${B}${c.primary}❯${R} ` : '  ';

  const nameColor = selected ? `${B}${c.text}` : c.muted;
  const agent = node.item.agent !== node.item.name ? `${D}[${node.item.agent}]${R} ` : '';

  // Hotness indicator
  const hot = node.aggregate.hotness > 0.1
    ? ` ${hotnessColor(node.aggregate.hotness)}${'▪'.repeat(Math.min(3, Math.ceil(node.aggregate.hotness * 2)))}${R}`
    : '';

  // Stats summary
  const statsParts: string[] = [];
  if (node.item.toolCount > 0) statsParts.push(`${node.item.toolCount}t`);
  if (node.item.durationSeconds > 0) statsParts.push(formatDuration(node.item.durationSeconds));
  if (node.aggregate.descendantCount > 0) statsParts.push(`+${node.aggregate.descendantCount}`);
  const stats = statsParts.length > 0 ? ` ${D}${c.muted}${statsParts.join(' ')}${R}` : '';

  return `${prefix}${indent}${glyph} ${nameColor}${node.item.name}${R} ${agent}${hot}${stats}`;
}

function formatAgentDetail(node: SubagentNode, width: number): string[] {
  const lines: string[] = [];
  const p = node.item;
  const a = node.aggregate;

  // Agent name + status
  const glyph = STATUS_GLYPH[p.status] || '?';
  lines.push(`${glyph} ${B}${c.text}${p.name}${R} ${D}(${p.agent})${R} ${D}depth:${p.depth} idx:${p.index}${R}`);

  // Stats grid
  const row1 = [
    `${c.muted}Tools:${R} ${c.text}${p.toolCount}${R}`,
    `${c.muted}Duration:${R} ${c.text}${formatDuration(p.durationSeconds)}${R}`,
    `${c.muted}Hotness:${R} ${hotnessColor(a.hotness)}${a.hotness.toFixed(2)}t/s${R}`,
  ].join(` ${c.subtle}│${R} `);
  lines.push(`  ${row1}`);

  const row2 = [
    `${c.muted}In:${R} ${formatTokens(p.inputTokens)}`,
    `${c.muted}Out:${R} ${formatTokens(p.outputTokens)}`,
    `${c.muted}Desc:${R} ${a.descendantCount}`,
    `${c.muted}Active:${R} ${a.activeCount}`,
  ].join(` ${c.subtle}│${R} `);
  lines.push(`  ${row2}`);

  // Files touched
  const allFiles = [...new Set([...p.filesRead, ...p.filesWritten])];
  if (allFiles.length > 0) {
    const shown = allFiles.slice(0, 3);
    const extra = allFiles.length > 3 ? ` +${allFiles.length - 3}` : '';
    lines.push(`  ${c.muted}Files:${R} ${shown.join(', ')}${extra}`);
  }

  // Subtree aggregate
  if (a.descendantCount > 0) {
    lines.push(`  ${c.muted}Subtree:${R} ${a.totalTools} tools, ${formatDuration(a.totalDuration)}, ${a.filesTouched} files`);
  }

  return lines;
}

// ─── Standalone Usage ───────────────────────────────────────────

/**
 * Render the overlay as a standalone string (for non-TUI contexts).
 */
export function renderAgentOverlayStandalone(): string {
  const overlay = new AgentOverlayComponent();
  overlay.show();
  return overlay.render(80).join('\n');
}
