/**
 * Claude settings interop.
 *
 * Reads and parses .claude/settings.json for permission migration.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ClaudeSettings {
  permissions?: ParsedPermissions;
  defaultMode?: string;
  additionalDirectories?: string[];
  env?: Record<string, string>;
}

export interface ParsedPermissions {
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface ClaudePermissionConfig {
  rules: Array<{
    action: 'allow' | 'deny' | 'ask';
    tool: string;
    pattern?: string;
  }>;
  warnings: string[];
}

/**
 * Load Claude settings from a file path.
 */
export function loadClaudeSettings(filePath: string): ClaudeSettings | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    return null;
  }
}

/**
 * Find Claude settings file in project or home directory.
 */
export function findClaudeSettings(cwd: string): string | null {
  const candidates = [
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, 'claude.settings.json'),
    path.join(process.env['HOME'] || process.env['USERPROFILE'] || '', '.claude', 'settings.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Convert Claude permissions to native permission config.
 */
export function convertClaudePermissions(permissions: ParsedPermissions): ClaudePermissionConfig {
  const rules: ClaudePermissionConfig['rules'] = [];
  const warnings: string[] = [];

  for (const [action, entries, label] of [
    ['allow', permissions.allow, 'allow'] as const,
    ['deny', permissions.deny, 'deny'] as const,
    ['ask', permissions.ask, 'ask'] as const,
  ]) {
    for (const ruleStr of entries) {
      try {
        const parsed = parseClaudePermissionRule(ruleStr, action as 'allow' | 'deny' | 'ask');
        if (parsed) rules.push(parsed);
      } catch (e: any) {
        warnings.push(`permissions.${label}: ${ruleStr} -- ${e.message}`);
      }
    }
  }

  return { rules, warnings };
}

/**
 * Parse a Claude permission rule string.
 */
function parseClaudePermissionRule(
  ruleStr: string,
  action: 'allow' | 'deny' | 'ask'
): { action: 'allow' | 'deny' | 'ask'; tool: string; pattern?: string } | null {
  // Match patterns like "Bash(npm run build)" or "Read(src/**)"
  const match = ruleStr.match(/^(\w+)(?:\((.+)\))?$/);
  if (!match) return null;

  const tool = match[1];
  const pattern = match[2];

  return { action, tool, pattern };
}

/**
 * Get the default mode from Claude settings.
 */
export function getDefaultMode(settings: ClaudeSettings): string {
  return settings.defaultMode ?? 'default';
}
