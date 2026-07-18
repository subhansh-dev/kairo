/**
 * Lightweight skill metadata utilities.
 *
 * Shared by prompt builder and skill tools. Intentionally avoids importing
 * heavy dependencies — safe to import at module level.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';

// Directories to skip during skill scanning
export const EXCLUDED_SKILL_DIRS = new Set([
  '.git', '.github', '.hub', '.archive',
  '.venv', 'venv', 'node_modules', 'site-packages',
  '__pycache__', '.tox', '.nox', '.pytest_cache',
  '.mypy_cache', '.ruff_cache',
]);

// Support directories inside a skill package (not standalone skills)
export const SKILL_SUPPORT_DIRS = new Set(['references', 'templates', 'assets', 'scripts']);

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  globs?: string[];
  'always-apply'?: boolean;
  alwaysApply?: boolean;
  platforms?: string[];
  [key: string]: unknown;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  /** @deprecated Use frontmatter instead */
  meta: SkillFrontmatter;
}

/**
 * Check if a path should be skipped by active skill scanners.
 */
export function isExcludedSkillPath(path: string): boolean {
  const parts = path.split(/[/\\]/);
  return parts.some(p => EXCLUDED_SKILL_DIRS.has(p)) || isSkillSupportPath(path);
}

/**
 * Check if a path is under a support dir of an actual skill root.
 */
export function isSkillSupportPath(path: string): boolean {
  const parts = path.split(/[/\\]/);
  for (let idx = 0; idx < parts.length - 1; idx++) {
    const part = parts[idx];
    if (!SKILL_SUPPORT_DIRS.has(part) || idx === 0) continue;
    const skillRoot = parts.slice(0, idx).join('/');
    if (existsSync(join(skillRoot, 'SKILL.md'))) return true;
  }
  return false;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns [frontmatter_dict, remaining_body].
 */
export function parseFrontmatter(content: string): ParsedSkill {
  const frontmatter: SkillFrontmatter = {};

  // Strip leading BOM
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  let body = content;

  if (!content.startsWith('---')) return { frontmatter, body, meta: frontmatter };

  const endMatch = content.slice(3).match(/\n---\s*\n/);
  if (!endMatch) return { frontmatter, body, meta: frontmatter };

  const yamlContent = content.slice(3, endMatch.index! + 3);
  body = content.slice(endMatch.index! + endMatch[0].length + 3);

  // Simple key:value parser (avoids yaml dependency for frontmatter)
  for (const line of yamlContent.trim().split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();

    // Handle simple types
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value)) value = parseInt(value, 10);

    // Handle YAML arrays (simple format: - item)
    if (key === '' && line.trim().startsWith('- ')) {
      // continuation of a list — skip (complex parsing deferred)
      continue;
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body, meta: frontmatter };
}

/**
 * Check if a skill's platforms list matches the current OS.
 */
export function skillMatchesPlatform(frontmatter: SkillFrontmatter): boolean {
  const platforms = frontmatter.platforms;
  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) return true;

  const current = process.platform;
  for (const p of platforms) {
    const normalized = String(p).toLowerCase().trim();
    if (current === 'linux' && normalized === 'linux') return true;
    if (current === 'darwin' && (normalized === 'macos' || normalized === 'darwin')) return true;
    if (current === 'win32' && (normalized === 'windows' || normalized === 'win32')) return true;
  }
  return false;
}

/**
 * Check if a skill should always be applied (loaded every session).
 */
export function isAlwaysApply(frontmatter: SkillFrontmatter): boolean {
  return frontmatter['always-apply'] === true || frontmatter.alwaysApply === true;
}

/**
 * Get the skills directory path.
 */
export function getSkillsDir(): string {
  const override = process.env.KAIRO_SKILLS_DIR;
  if (override) return override;
  return join(homedir(), '.kairo', 'skills');
}

/**
 * Get the config file path.
 */
export function getConfigPath(): string {
  return join(homedir(), '.kairo', 'config.yaml');
}
