/**
 * Discover skills — skill discovery utilities.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

export interface DiscoveredSkill {
  name: string;
  path: string;
  description?: string;
  alwaysApply: boolean;
  size: number;
}

/**
 * Discover skills in a directory.
 */
export function discoverSkills(dir: string): DiscoveredSkill[] {
  if (!existsSync(dir)) return [];

  const skills: DiscoveredSkill[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && (entry.endsWith('.md') || entry.endsWith('.txt'))) {
        const content = readFileSync(fullPath, 'utf-8');
        const { frontmatter } = parseSimpleFrontmatter(content);
        skills.push({
          name: frontmatter.name || basename(entry, entry.includes('.') ? '.' + entry.split('.').pop() : ''),
          path: fullPath,
          description: frontmatter.description,
          alwaysApply: frontmatter['always-apply'] === true,
          size: stat.size,
        });
      } else if (stat.isDirectory()) {
        // Check for SKILL.md in subdirectory
        const skillFile = join(fullPath, 'SKILL.md');
        if (existsSync(skillFile)) {
          const content = readFileSync(skillFile, 'utf-8');
          const { frontmatter } = parseSimpleFrontmatter(content);
          skills.push({
            name: frontmatter.name || entry,
            path: skillFile,
            description: frontmatter.description,
            alwaysApply: frontmatter['always-apply'] === true,
            size: statSync(skillFile).size,
          });
        }
      }
    }
  } catch { /* best-effort */ }

  return skills;
}

/**
 * Discover skills from all standard locations.
 */
/**
 * Format a discovered skill for display.
 */
export function formatSkill(skill: DiscoveredSkill): string {
  const icon = skill.alwaysApply ? '📌' : '📄';
  const desc = skill.description ? ` — ${skill.description}` : '';
  return `  ${icon} ${skill.name}${desc}`;
}

export function discoverAllSkills(): DiscoveredSkill[] {
  const dirs = [
    join(homedir(), '.kairo', 'skills'),
    join(process.cwd(), '.kairo', 'skills'),
  ];

  const allSkills: DiscoveredSkill[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const skills = discoverSkills(dir);
    for (const skill of skills) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        allSkills.push(skill);
      }
    }
  }

  return allSkills;
}

function parseSimpleFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const frontmatter: Record<string, any> = {};
  let body = content;

  if (content.startsWith('---')) {
    const endMatch = content.slice(3).match(/\n---\s*\n/);
    if (endMatch) {
      const yamlContent = content.slice(3, endMatch.index! + 3);
      body = content.slice(endMatch.index! + endMatch[0].length + 3);
      for (const line of yamlContent.trim().split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value: any = line.slice(colonIdx + 1).trim();
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body };
}
