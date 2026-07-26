/**
 * Skill guard — prevent skill-related security issues.
 */

import { scanForThreats } from './threat-patterns.js';

export interface SkillGuardResult {
  safe: boolean;
  warnings: string[];
  blocked: boolean;
  blockReason?: string;
}

/**
 * Check a skill file for security issues.
 */
export function guardSkill(content: string, filename: string): SkillGuardResult {
  const warnings: string[] = [];
  let blocked = false;
  let blockReason: string | undefined;

  // Check for prompt injection
  const threats = scanForThreats(content, 'context');
  if (threats.length > 0) {
    const highSeverity = threats.filter(t => t.severity === 'high');
    if (highSeverity.length > 0) {
      blocked = true;
      blockReason = `Skill contains potential prompt injection: ${highSeverity.map(t => t.category).join(', ')}`;
    } else {
      warnings.push(`Skill contains suspicious patterns: ${threats.map(t => t.category).join(', ')}`);
    }
  }

  // Check for excessive size
  if (content.length > 100_000) {
    warnings.push(`Skill is very large (${content.length} chars) — may impact performance`);
  }

  // Check for dangerous patterns in scripts
  if (content.includes('rm -rf') || content.includes('curl | sh') || content.includes('wget | sh')) {
    warnings.push('Skill contains potentially dangerous shell commands');
  }

  // Check for external URLs
  const urlMatches = content.match(/https?:\/\/[^\s"'<>]+/g);
  if (urlMatches && urlMatches.length > 5) {
    warnings.push(`Skill references ${urlMatches.length} external URLs`);
  }

  return { safe: !blocked, warnings, blocked, blockReason };
}

/**
 * Sanitize skill content for safe loading.
 */
export function sanitizeSkillContent(content: string): string {
  // Remove null bytes
  let sanitized = content.replace(/\0/g, '');
  // Trim excessive whitespace
  sanitized = sanitized.replace(/\n{5,}/g, '\n\n\n');
  return sanitized;
}
