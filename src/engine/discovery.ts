/**
 * Discovery — skills, plugins, AGENTS.md, project config, permissions discovery.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  content: string;
  source: 'project' | 'user' | 'builtin';
}

export interface SkillsConfig {
  enabled?: boolean;
  builtinDir?: string;
}

export interface AgentConfigFile {
  filePath: string;
  content: string;
  source: 'agents_md' | 'claude_md' | 'rules';
}

export interface DiscoveredPlugin {
  name: string;
  path: string;
  manifest: any;
}

export interface PluginDiscoveryConfig {
  enabled?: boolean;
  dirs?: string[];
}

export interface ProjectConfig {
  mcpServers?: Record<string, any>;
  hooks?: Record<string, any>;
  settings?: Record<string, any>;
}

export interface ResolvedPermissions {
  rules: any[];
  mode: string;
}

/**
 * Discover skills from the workspace root.
 */
export async function discoverSkills(
  rootCwd: string,
  config?: SkillsConfig
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  // Project-level skills
  const projectSkillsDir = path.join(rootCwd, '.claude', 'skills');
  try {
    const entries = await fs.readdir(projectSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.name.endsWith('.md')) {
        const skillPath = entry.isDirectory()
          ? path.join(projectSkillsDir, entry.name, 'SKILL.md')
          : path.join(projectSkillsDir, entry.name);

        try {
          const content = await fs.readFile(skillPath, 'utf-8');
          const name = entry.isDirectory() ? entry.name : entry.name.replace('.md', '');
          skills.push({
            name,
            description: extractDescription(content),
            path: skillPath,
            content,
            source: 'project',
          });
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* dir doesn't exist */ }

  // User-level skills
  const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
  try {
    const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.name.endsWith('.md')) {
        const skillPath = entry.isDirectory()
          ? path.join(userSkillsDir, entry.name, 'SKILL.md')
          : path.join(userSkillsDir, entry.name);

        try {
          const content = await fs.readFile(skillPath, 'utf-8');
          const name = entry.isDirectory() ? entry.name : entry.name.replace('.md', '');
          skills.push({
            name,
            description: extractDescription(content),
            path: skillPath,
            content,
            source: 'user',
          });
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* dir doesn't exist */ }

  return skills;
}

/**
 * Discover project-instruction files (AGENTS.md, Claude.md, rules).
 */
export async function discoverAgentsMd(rootCwd: string): Promise<AgentConfigFile[]> {
  const files: AgentConfigFile[] = [];
  const candidates = [
    { path: 'AGENTS.md', source: 'agents_md' as const },
    { path: 'CLAUDE.md', source: 'claude_md' as const },
    { path: '.claude/rules', source: 'rules' as const },
    { path: '.grok/rules', source: 'rules' as const },
  ];

  let current = rootCwd;
  const maxDepth = 20;

  for (let i = 0; i < maxDepth; i++) {
    for (const candidate of candidates) {
      const filePath = path.join(current, candidate.path);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          let content = await fs.readFile(filePath, 'utf-8');
          // Strip YAML frontmatter for rules files
          if (candidate.source === 'rules') {
            content = stripFrontmatter(content);
          }
          files.push({ filePath, content, source: candidate.source });
        }
      } catch { /* not found */ }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return files;
}

/**
 * Discover plugins from configured directories.
 */
export async function discoverPlugins(
  rootCwd: string,
  config?: PluginDiscoveryConfig
): Promise<DiscoveredPlugin[]> {
  const plugins: DiscoveredPlugin[] = [];
  const dirs = config?.dirs || [
    path.join(rootCwd, '.grok', 'plugins'),
    path.join(os.homedir(), '.grok', 'plugins'),
  ];

  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const manifestPath = path.join(dir, entry.name, 'manifest.json');
          try {
            const content = await fs.readFile(manifestPath, 'utf-8');
            plugins.push({
              name: entry.name,
              path: path.join(dir, entry.name),
              manifest: JSON.parse(content),
            });
          } catch { /* no manifest */ }
        }
      }
    } catch { /* dir doesn't exist */ }
  }

  return plugins;
}

/**
 * Load project config from .grok/config.toml files.
 */
export async function loadProjectConfig(rootCwd: string): Promise<ProjectConfig> {
  const config: ProjectConfig = {};
  const configFiles = [
    path.join(rootCwd, '.grok', 'config.toml'),
    path.join(rootCwd, '.mcp.json'),
  ];

  for (const configFile of configFiles) {
    try {
      const content = await fs.readFile(configFile, 'utf-8');
      if (configFile.endsWith('.json')) {
        const parsed = JSON.parse(content);
        if (parsed.mcpServers) config.mcpServers = parsed.mcpServers;
      }
    } catch { /* not found */ }
  }

  return config;
}

/**
 * Load permissions from config files.
 */
export async function loadPermissions(rootCwd: string): Promise<ResolvedPermissions> {
  const permissions: ResolvedPermissions = { rules: [], mode: 'ask' };

  const permFiles = [
    path.join(rootCwd, '.grok', 'permissions.toml'),
    path.join(rootCwd, '.grok', 'permissions.json'),
  ];

  for (const permFile of permFiles) {
    try {
      const content = await fs.readFile(permFile, 'utf-8');
      if (permFile.endsWith('.json')) {
        const parsed = JSON.parse(content);
        if (parsed.rules) permissions.rules = parsed.rules;
        if (parsed.mode) permissions.mode = parsed.mode;
      }
    } catch { /* not found */ }
  }

  return permissions;
}

function extractDescription(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed.substring(0, 200);
    }
  }
  return '';
}

function stripFrontmatter(content: string): string {
  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3);
    if (endIdx > 0) {
      return content.substring(endIdx + 3).trim();
    }
  }
  return content;
}
