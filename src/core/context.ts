/**
 * Kairo — Context System
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';

// ─── Context File Loading ──────────────────────────────────────

interface ContextFile {
  path: string;
  content: string;
  source: 'user' | 'project' | 'parent';
}

/**
 * Load context files (CLAUDE.md, AGENTS.md, KAIRO.md) from project hierarchy
 */
export function loadContextFiles(projectDir?: string): ContextFile[] {
  const files: ContextFile[] = [];
  const dir = projectDir || process.cwd();

  // Load from project root
  for (const name of ['KAIRO.md', 'CLAUDE.md', 'AGENTS.md']) {
    const path = join(dir, name);
    if (existsSync(path)) {
      files.push({ path, content: readFileSync(path, 'utf-8'), source: 'project' });
    }
  }

  // Walk up parent directories (stop at home or root)
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let current = dirname(dir);
  let prev = '';
  while (current && current !== home && current !== '/' && current !== prev) {
    prev = current;
    for (const name of ['KAIRO.md', 'CLAUDE.md']) {
      const path = join(current, name);
      if (existsSync(path)) {
        files.push({ path, content: readFileSync(path, 'utf-8'), source: 'parent' });
      }
    }
    current = dirname(current);
  }

  // Load user-level config
  const userConfig = join(home, '.kairo', 'KAIRO.md');
  if (existsSync(userConfig)) {
    files.push({ path: userConfig, content: readFileSync(userConfig, 'utf-8'), source: 'user' });
  }

  return files;
}

/**
 * Build context string from loaded files
 */
export function buildContextString(files: ContextFile[]): string {
  if (files.length === 0) return '';
  return '\n\n# Project Context\n\n' +
    files.map(f => `## ${f.source}: ${f.path}\n\n${f.content}`).join('\n\n---\n\n');
}

// ─── Git Context ──────────────────────────────

interface GitContext {
  branch: string;
  mainBranch: string;
  recentCommits: string;
  status: string;
  root: string;
}

export function getGitContext(): GitContext | null {
  const execOpts = { encoding: 'utf-8' as const, timeout: 3000, stdio: 'pipe' as const };
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).trim();
    const root = execSync('git rev-parse --show-toplevel', execOpts).trim();

    let mainBranch = 'main';
    try {
      mainBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', execOpts)
        .trim().replace('refs/remotes/origin/', '');
    } catch { /* use default */ }

    let recentCommits = '';
    try {
      recentCommits = execSync('git log --oneline -5', execOpts).trim();
    } catch { /* empty repo */ }

    let status = '';
    try {
      status = execSync('git status --short', execOpts).trim();
    } catch { /* not in git repo */ }

    return { branch, mainBranch, recentCommits, status, root };
  } catch {
    return null;
  }
}

export function buildGitContextString(): string {
  const ctx = getGitContext();
  if (!ctx) return '';

  let str = `\n\n# Git Context\nBranch: ${ctx.branch}`;
  if (ctx.branch !== ctx.mainBranch) str += ` (main: ${ctx.mainBranch})`;
  if (ctx.recentCommits) str += `\n\nRecent commits:\n${ctx.recentCommits}`;
  if (ctx.status) str += `\n\nWorking tree status:\n${ctx.status}`;
  return str;
}

// ─── File Safety ────────────────────────────

const SENSITIVE_PATHS = [
  '.ssh', '.gnupg', '.aws', '.azure', '.config/gcloud',
  '.env', '.env.local', '.env.production', '.env.development',
  '.netrc', '.npmrc', '.pypirc', '.cargo/credentials',
  'id_rsa', 'id_ed25519', 'id_ecdsa',
  'shadow', 'passwd', 'master.key',
  'credentials.json', 'token.json', 'service-account.json',
];

const SENSITIVE_PATTERNS = [
  /\/\.ssh\//i,
  /\/\.gnupg\//i,
  /\/\.aws\//i,
  /\/\.env$/i,
  /\/\.env\.\w+$/i,
  /\/\.netrc$/i,
  /id_rsa$/i,
  /id_ed25519$/i,
  /\/shadow$/i,
  /\/passwd$/i,
  /master\.key$/i,
  /credentials\.json$/i,
  /token\.json$/i,
];

/**
 */
export function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return SENSITIVE_PATTERNS.some(p => p.test(normalized));
}

/**
 * Check if content looks like it contains secrets
 */
export function containsSecrets(content: string): boolean {
  const patterns = [
    /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    /(?:token|bearer)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    /(?:sk|pk|nvapi|gsk|csk)-[a-zA-Z0-9]{20,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /ghp_[a-zA-Z0-9]{36}/,
    /gho_[a-zA-Z0-9]{36}/,
  ];
  return patterns.some(p => p.test(content));
}

// ─── Coding Context Awareness ───────────────

const PROJECT_MARKERS = [
  'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'Makefile', 'CMakeLists.txt',
  'Gemfile', 'requirements.txt', 'setup.py', 'composer.json',
  '.git', '.gitignore',
];

/**
 * Detect if current directory is a coding workspace
 */
export function detectCodingContext(dir?: string): { isWorkspace: boolean; type: string; markers: string[] } {
  const target = dir || process.cwd();
  const markers: string[] = [];

  for (const marker of PROJECT_MARKERS) {
    if (existsSync(join(target, marker))) {
      markers.push(marker);
    }
  }

  if (markers.length === 0) return { isWorkspace: false, type: 'unknown', markers };

  // Detect project type
  let type = 'generic';
  if (markers.includes('package.json')) type = 'node';
  else if (markers.includes('pyproject.toml') || markers.includes('requirements.txt')) type = 'python';
  else if (markers.includes('Cargo.toml')) type = 'rust';
  else if (markers.includes('go.mod')) type = 'go';
  else if (markers.includes('pom.xml') || markers.includes('build.gradle')) type = 'java';
  else if (markers.includes('Gemfile')) type = 'ruby';
  else if (markers.includes('composer.json')) type = 'php';

  return { isWorkspace: true, type, markers };
}

// ─── Build Full Context ─────────────────────────────────────────

export interface FullContext {
  contextFiles: string;
  gitContext: string;
  codingContext: string;
  combined: string;
}

export function buildFullContext(projectDir?: string): FullContext {
  const contextFiles = buildContextString(loadContextFiles(projectDir));
  const gitContext = buildGitContextString();
  const coding = detectCodingContext(projectDir);

  let codingContext = '';
  if (coding.isWorkspace) {
    codingContext = `\n\n# Workspace: ${coding.type} project (${coding.markers.join(', ')})`;
  }

  const combined = contextFiles + gitContext + codingContext;

  return { contextFiles, gitContext, codingContext, combined };
}
