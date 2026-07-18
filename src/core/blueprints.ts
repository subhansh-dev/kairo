/**
 * Kairo — Blueprint System
 * Shareable automations layered on skills + cron.
 * Ported from Hermes Agent's blueprints.py
 *
 * A "blueprint" is an ordinary skill that additionally declares an automation
 * schedule in its frontmatter. Because a blueprint is just a skill, it flows
 * through the existing skills pipeline.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

// ─── Types ──────────────────────────────────────────────────────

export interface BlueprintSpec {
  name: string;
  description: string;
  schedule: string; // cron expression
  deliver: 'origin' | 'webhook' | 'none';
  prompt?: string; // task instruction for the run
  noAgent: boolean;
  skillPath: string;
  content: string;
}

export interface BlueprintJob {
  id: string;
  blueprintName: string;
  schedule: string;
  lastRun?: number;
  nextRun?: number;
  enabled: boolean;
}

// ─── Blueprint Parsing ──────────────────────────────────────────

/**
 * Parse a blueprint spec from skill markdown content.
 * Returns null if no blueprint metadata is found.
 */
export function parseBlueprint(skillContent: string, skillPath?: string): BlueprintSpec | null {
  // Extract frontmatter
  const match = skillContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2];

  // Look for blueprint metadata
  const blueprintMatch = frontmatter.match(/blueprint:\s*\n([\s\S]*?)(?=\n\S|\n---|$)/);
  if (!blueprintMatch) return null;

  const blueprintBlock = blueprintMatch[1];

  // Parse schedule
  const scheduleMatch = blueprintBlock.match(/schedule:\s*["']?(.+?)["']?\s*$/m);
  if (!scheduleMatch) return null;
  const schedule = scheduleMatch[1].trim();

  // Parse deliver
  const deliverMatch = blueprintBlock.match(/deliver:\s*(\w+)/);
  const deliver = (deliverMatch?.[1] || 'origin') as BlueprintSpec['deliver'];

  // Parse prompt
  const promptMatch = blueprintBlock.match(/prompt:\s*["'](.+?)["']/);

  // Parse no_agent
  const noAgentMatch = blueprintBlock.match(/no_agent:\s*(true|false)/);
  const noAgent = noAgentMatch?.[1] === 'true';

  // Extract name from frontmatter
  const nameMatch = frontmatter.match(/name:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim() || (skillPath ? basename(skillPath, '.md') : 'unnamed');

  // Extract description
  const descMatch = frontmatter.match(/description:\s*(.+)$/m);
  const description = descMatch?.[1]?.trim() || '';

  return {
    name,
    description,
    schedule,
    deliver,
    prompt: promptMatch?.[1] || undefined,
    noAgent,
    skillPath: skillPath || '',
    content: body,
  };
}

/**
 * Scan skills directories for blueprints.
 */
export function discoverBlueprints(): BlueprintSpec[] {
  const blueprints: BlueprintSpec[] = [];
  const dirs = [
    join(homedir(), '.kairo', 'skills'),
    join(process.cwd(), '.kairo', 'skills'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const skillPath = join(dir, entry);
      try {
        const content = readFileSync(skillPath, 'utf-8');
        const spec = parseBlueprint(content, skillPath);
        if (spec) blueprints.push(spec);
      } catch {}
    }
  }

  return blueprints;
}

/**
 * Get a blueprint by name.
 */
export function getBlueprint(name: string): BlueprintSpec | null {
  const blueprints = discoverBlueprints();
  return blueprints.find(b => b.name === name) || null;
}

/**
 * Create a cron job from a blueprint spec.
 */
export function blueprintToJobSpec(spec: BlueprintSpec): BlueprintJob {
  return {
    id: `bp_${spec.name}_${Date.now()}`,
    blueprintName: spec.name,
    schedule: spec.schedule,
    enabled: true,
  };
}

/**
 * Export a blueprint as a shareable SKILL.md string.
 */
export function exportBlueprint(spec: BlueprintSpec): string {
  const frontmatter = [
    '---',
    `name: ${spec.name}`,
    `description: ${spec.description}`,
    'metadata:',
    '  kairo:',
    '    blueprint:',
    `      schedule: "${spec.schedule}"`,
    `      deliver: ${spec.deliver}`,
    spec.prompt ? `      prompt: "${spec.prompt}"` : null,
    spec.noAgent ? '      no_agent: true' : null,
    '---',
  ].filter(Boolean).join('\n');

  return `${frontmatter}\n\n${spec.content}`;
}

/**
 * Format blueprint list for display.
 */
export function formatBlueprints(): string {
  const blueprints = discoverBlueprints();
  if (blueprints.length === 0) return 'No blueprints found.';

  const lines = ['## Blueprints', ''];
  for (const bp of blueprints) {
    lines.push(`  ● ${bp.name} — ${bp.description}`);
    lines.push(`    Schedule: ${bp.schedule} | Deliver: ${bp.deliver}`);
    if (bp.prompt) lines.push(`    Prompt: ${bp.prompt.slice(0, 80)}...`);
    lines.push('');
  }

  return lines.join('\n');
}
