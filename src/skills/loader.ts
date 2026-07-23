/**
 * Kairo — Skills System
 * Loads skills from ~/.kairo/skills/, .kairo/skills/, and ~/.claude/skills/
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  globs?: string[];
  alwaysApply?: boolean;
  hide?: boolean;
  disableModelInvocation?: boolean;
}

export interface Skill {
  name: string;
  path: string;
  content: string;
  frontmatter?: SkillFrontmatter;
  source: 'user' | 'project' | 'claude' | 'system';
}

function parseFrontmatter(content: string): { meta: SkillFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: SkillFrontmatter = {};
  const yamlContent = match[1];
  let currentKey: string | null = null;
  let currentValue: string = '';
  let inArray = false;
  let arrayItems: string[] = [];

  for (const line of yamlContent.split('\n')) {
    const colon = line.indexOf(':');
    // Check if this is a new key-value line (not indented)
    if (colon > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Flush previous key
      if (currentKey) {
        flushKeyValue(meta, currentKey, currentValue, inArray ? arrayItems : undefined);
      }
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 1).trim();
      // Check for array start
      if ((val === '' || val === undefined) || val.startsWith('[')) {
        // Inline array like [item1, item2]
        if (val.startsWith('[')) {
          const items = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
          currentKey = key;
          currentValue = val;
          inArray = false;
          arrayItems = items;
          continue;
        }
        inArray = true;
        arrayItems = [];
        currentKey = key;
        currentValue = val;
        continue;
      }
      currentKey = key;
      currentValue = val;
      inArray = false;
      arrayItems = [];
    } else if (inArray && (line.startsWith('  - ') || line.startsWith('    - '))) {
      // YAML array item (indented dash)
      const item = line.replace(/^\s*- /, '').trim().replace(/^['"]|['"]$/g, '');
      arrayItems.push(item);
    } else if (currentKey) {
      // Multi-line value continuation (indented)
      currentValue += '\n' + line;
    }
  }
  // Flush last key
  if (currentKey) {
    flushKeyValue(meta, currentKey, currentValue, inArray ? arrayItems : undefined);
  }

  return { meta, body: match[2] };
}

function flushKeyValue(meta: SkillFrontmatter, key: string, val: string, arrayItems?: string[]): void {
  // Normalize key names (support both camelCase and kebab-case)
  const normalizedKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (normalizedKey === 'globs') {
    meta.globs = arrayItems || val.split(',').map(s => s.trim());
  } else if (normalizedKey === 'alwaysApply') {
    meta.alwaysApply = val === 'true' || val === 'yes';
  } else if (normalizedKey === 'hide') {
    meta.hide = val === 'true' || val === 'yes';
  } else if (normalizedKey === 'disableModelInvocation') {
    meta.disableModelInvocation = val === 'true' || val === 'yes';
  } else if (normalizedKey === 'name') {
    meta.name = val;
  } else if (normalizedKey === 'description') {
    meta.description = val;
  }
}

function loadSkillDir(dirPath: string, source: 'user' | 'project' | 'claude' | 'system'): Skill[] {
  const skills: Skill[] = [];
  if (!existsSync(dirPath)) return skills;

  for (const entry of readdirSync(dirPath)) {
    const skillPath = join(dirPath, entry);
    try {
      const stat = statSync(skillPath);

      if (stat.isFile() && entry.endsWith('.md')) {
        const content = readFileSync(skillPath, 'utf-8');
        const { meta, body } = parseFrontmatter(content);
        skills.push({
          name: meta.name || basename(entry, '.md'),
          path: skillPath,
          content: body,
          frontmatter: meta,
          source,
        });
      } else if (stat.isDirectory()) {
        // Check for SKILL.md in subdirectory
        const skillFile = join(skillPath, 'SKILL.md');
        if (existsSync(skillFile)) {
          const content = readFileSync(skillFile, 'utf-8');
          const { meta, body } = parseFrontmatter(content);
          skills.push({
            name: meta.name || entry,
            path: skillFile,
            content: body,
            frontmatter: meta,
            source,
          });
        }
      }
    } catch (e: any) {
      // Don't silently swallow errors — at least log a warning
      if (process.env.DEBUG_SKILLS) console.warn(`[Skills] Failed to load ${skillPath}: ${e.message}`);
    }
  }

  return skills;
}

export class SkillLoader {
  private skills: Skill[] = [];

  constructor(projectDir?: string) {
    this.load(projectDir);
  }

  private load(projectDir?: string) {
    // Built-in system skills (from the skills/ directory alongside the project root)
    // These include the master system prompt and soul.md
    // Resolve relative to the project's root: try both dist/ and src/ paths
    const projectRoot = projectDir || process.cwd();
    const systemSkillsCandidates = [
      join(projectRoot, 'skills'),
      join(projectRoot, '..', '..', 'skills'),
    ];
    // Also try the Kairo package installation directory
    // Use ESM-compatible path resolution (import.meta.url) when available,
    // fall back to process.argv[1] for CLI contexts, and skip require.resolve
    // since it's not available in ESM/bundled builds.
    try {
      // ESM: derive from import.meta.url (available when compiled as ESM)
      if (typeof (globalThis as any).__kairo_dir === 'string') {
        systemSkillsCandidates.push(join((globalThis as any).__kairo_dir, 'skills'));
      } else if (process.argv[1]) {
        systemSkillsCandidates.push(join(dirname(process.argv[1]), 'skills'));
      }
    } catch { /* no install path discoverable */ }
    
    for (const dir of systemSkillsCandidates) {
      if (existsSync(dir)) {
        this.skills.push(...loadSkillDir(dir, 'system'));
        break;
      }
    }

    // User skills (~/.kairo/skills/)
    const userSkillsDir = join(homedir(), '.kairo', 'skills');
    this.skills.push(...loadSkillDir(userSkillsDir, 'user'));

    // Project skills (.kairo/skills/)
    if (projectDir) {
      const projectSkillsDir = join(projectDir, '.kairo', 'skills');
      this.skills.push(...loadSkillDir(projectSkillsDir, 'project'));
    }

    // Kairo skills (~/.claude/skills/) — load for reference
    const claudeSkillsDir = join(homedir(), '.claude', 'skills');
    this.skills.push(...loadSkillDir(claudeSkillsDir, 'claude'));

    // Project Claude skills (.claude/skills/)
    if (projectDir) {
      const claudeProjectSkills = join(projectDir, '.claude', 'skills');
      this.skills.push(...loadSkillDir(claudeProjectSkills, 'claude'));
    }
  }

  all(): Skill[] {
    return this.skills;
  }

  find(query: string): Skill | undefined {
    const lower = query.toLowerCase();
    return this.skills.find(s =>
      s.name.toLowerCase().includes(lower) ||
      (s.frontmatter?.description || '').toLowerCase().includes(lower)
    );
  }

  match(request: string): Skill[] {
    const lower = request.toLowerCase();
    const scored: Array<{ skill: Skill; score: number }> = [];
    
    for (const s of this.skills) {
      let score = 0;
      
      // Exact name match (highest priority)
      if (s.name.toLowerCase() === lower) score += 10;
      // Name contains query
      else if (s.name.toLowerCase().includes(lower)) score += 5;
      // Query contains name keyword
      else {
        const nameKeywords = s.name.split(/[-_]/);
        for (const kw of nameKeywords) {
          if (kw.length >= 2 && lower.includes(kw.toLowerCase())) score += 2;
        }
      }
      
      // Description match
      const desc = (s.frontmatter?.description || '').toLowerCase();
      if (desc && desc.includes(lower)) score += 3;
      
      // Glob match (proper glob matching)
      if (s.frontmatter?.globs) {
        for (const glob of s.frontmatter?.globs) {
          // Convert glob to regex for proper matching
          // First escape special regex chars (except our glob wildcards), then convert
          const escaped = glob.replace(/[.+^${}()|\\]/g, '\\$&'); // escape regex specials
          const globRegex = escaped.replace(/\\\*\\\*/g, '.+').replace(/\\\*/g, '[^/]*').replace(/\\\?/g, '[^/]');
          try {
            if (new RegExp(globRegex, 'i').test(request)) score += 2;
          } catch { /* invalid glob pattern — skip */ }
        }
      }
      
      // Content match (brief)
      if (s.content.toLowerCase().includes(lower) && score === 0) score += 1;
      
      if (score > 0) scored.push({ skill: s, score });
    }
    
    // Return sorted by relevance score
    return scored.sort((a, b) => b.score - a.score).map(s => s.skill);
  }

  getAlwaysApply(): Skill[] {
    return this.skills.filter(s => s.frontmatter?.alwaysApply);
  }

  renderForPrompt(): string {
    const visible = this.skills.filter(s => !s.frontmatter?.hide && !s.frontmatter?.disableModelInvocation);
    if (visible.length === 0) return '';

    return `\n\nAvailable skills:\n${visible.map(s => `- ${s.name}: ${s.frontmatter?.description || s.content.slice(0, 100)}`).join('\n')}`;
  }
}
