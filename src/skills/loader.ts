/**
 * Kairo — Skills System
 * Loads skills from ~/.kairo/skills/, .kairo/skills/, and ~/.claude/skills/
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
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
  source: 'user' | 'project' | 'claude';
}

function parseFrontmatter(content: string): { meta: SkillFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: SkillFrontmatter = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 1).trim();
      if (key === 'globs') meta.globs = val.split(',').map(s => s.trim());
      else if (key === 'always-apply' || key === 'alwaysApply') meta.alwaysApply = val === 'true';
      else if (key === 'hide') meta.hide = val === 'true';
      else if (key === 'disable-model-invocation' || key === 'disableModelInvocation') meta.disableModelInvocation = val === 'true';
      else if (key === 'name') meta.name = val;
      else if (key === 'description') meta.description = val;
    }
  }

  return { meta, body: match[2] };
}

function loadSkillDir(dirPath: string, source: 'user' | 'project' | 'claude'): Skill[] {
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
    } catch {}
  }

  return skills;
}

export class SkillLoader {
  private skills: Skill[] = [];

  constructor(projectDir?: string) {
    this.load(projectDir);
  }

  private load(projectDir?: string) {
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
    return this.skills.filter(s => {
      // Check name keywords
      const nameKeywords = s.name.split(/[-_]/);
      if (nameKeywords.some(kw => lower.includes(kw))) return true;
      // Check globs
      if (s.frontmatter?.globs) {
        // Simple glob matching
        return s.frontmatter.globs.some(g => lower.includes(g.replace('*', '')));
      }
      return false;
    });
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
