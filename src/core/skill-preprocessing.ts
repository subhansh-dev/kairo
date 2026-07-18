/**
 * Skill preprocessing — prepare skills for loading.
 */

export interface PreprocessedSkill {
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  alwaysApply: boolean;
  globs?: string[];
  description?: string;
}

/**
 * Preprocess a skill file for loading.
 */
export function preprocessSkill(raw: string, filename: string): PreprocessedSkill {
  let content = raw;
  const metadata: Record<string, unknown> = {};

  // Parse frontmatter if present
  if (content.startsWith('---')) {
    const endMatch = content.slice(3).match(/\n---\s*\n/);
    if (endMatch) {
      const yamlContent = content.slice(3, endMatch.index! + 3);
      content = content.slice(endMatch.index! + endMatch[0].length + 3);

      // Simple key:value parser
      for (const line of yamlContent.trim().split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value: any = line.slice(colonIdx + 1).trim();
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        metadata[key] = value;
      }
    }
  }

  // Extract name from filename or metadata
  const name = String(metadata.name || filename.replace(/\.(md|txt)$/, ''));

  // Check for always-apply
  const alwaysApply = metadata['always-apply'] === true || metadata.alwaysApply === true;

  // Extract globs
  const globs = metadata.globs
    ? (Array.isArray(metadata.globs) ? metadata.globs : [metadata.globs]).map(String)
    : undefined;

  return {
    name,
    content: content.trim(),
    metadata,
    alwaysApply,
    globs,
    description: metadata.description ? String(metadata.description) : undefined,
  };
}

/**
 * Check if a skill matches a file path based on its globs.
 */
export function skillMatchesPath(skill: PreprocessedSkill, filePath: string): boolean {
  if (!skill.globs || skill.globs.length === 0) return true; // No globs = matches everything

  for (const glob of skill.globs) {
    if (matchGlob(glob, filePath)) return true;
  }
  return false;
}

/**
 * Simple glob matching (supports * and **).
 */
function matchGlob(pattern: string, path: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(path);
}
