/**
 * Skill view — view skill contents.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

export interface SkillViewResult {
  name: string;
  content: string;
  path: string;
  metadata: Record<string, unknown>;
}

/**
 * View a skill's contents.
 */
export function viewSkill(skillPath: string): SkillViewResult | null {
  if (!existsSync(skillPath)) return null;

  const content = readFileSync(skillPath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(content);

  return {
    name: String(frontmatter.name || 'unknown'),
    content: body,
    path: skillPath,
    metadata: frontmatter,
  };
}

/**
 * View a specific file within a skill directory.
 */
export function viewSkillFile(skillDir: string, filePath: string): string | null {
  const fullPath = join(skillDir, filePath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf-8');
}

/**
 * List files in a skill directory.
 */
export function listSkillFiles(skillDir: string): string[] {
  if (!existsSync(skillDir)) return [];
  const { readdirSync } = require('fs');
  return readdirSync(skillDir);
}

function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
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
