/**
 * Kairo — Coding Context
 * Detects when the agent is in a coding workspace and adjusts behavior.
 * Ported from Hermes Agent's coding_context.py
 *
 * When inside a git repo or recognized project root, the agent enters
 * a "coding posture" — injecting workspace awareness into the system prompt.
 */

import { existsSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

// ─── Types ──────────────────────────────────────────────────────

export interface CodingContext {
  isCoding: boolean;
  projectType: string;
  gitBranch: string | null;
  gitDirty: boolean;
  rootMarker: string | null;
  language: string | null;
  testFramework: string | null;
  packageManager: string | null;
}

// ─── Project Markers ────────────────────────────────────────────

const PROJECT_MARKERS: Record<string, string> = {
  'package.json': 'node',
  'tsconfig.json': 'typescript',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'setup.cfg': 'python',
  'requirements.txt': 'python',
  'Cargo.toml': 'rust',
  'go.mod': 'go',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'build.gradle.kts': 'java',
  'Gemfile': 'ruby',
  'composer.json': 'php',
  'CMakeLists.txt': 'cpp',
  'Makefile': 'make',
  'deno.json': 'deno',
};

const TEST_FRAMEWORKS: Record<string, string> = {
  'vitest': 'vitest',
  'jest': 'jest',
  'pytest.ini': 'pytest',
  'pyproject.toml': 'pytest',
  'go.mod': 'go test',
  'Cargo.toml': 'cargo test',
};

const PACKAGE_MANAGERS: Record<string, string> = {
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'Pipfile': 'pipenv',
  'poetry.lock': 'poetry',
  'uv.lock': 'uv',
  'Cargo.lock': 'cargo',
  'go.sum': 'go',
};

// ─── Detection ──────────────────────────────────────────────────

export function detectCodingContext(projectDir: string = process.cwd()): CodingContext {
  const context: CodingContext = {
    isCoding: false,
    projectType: 'unknown',
    gitBranch: null,
    gitDirty: false,
    rootMarker: null,
    language: null,
    testFramework: null,
    packageManager: null,
  };

  // Detect project type from markers
  for (const [marker, lang] of Object.entries(PROJECT_MARKERS)) {
    if (existsSync(join(projectDir, marker))) {
      context.isCoding = true;
      context.projectType = lang;
      context.rootMarker = marker;
      context.language = lang;
      break;
    }
  }

  // Detect git info
  try {
    context.gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    const status = execSync('git status --porcelain', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    context.gitDirty = status.length > 0;
  } catch {}

  // Detect test framework
  for (const [marker, framework] of Object.entries(TEST_FRAMEWORKS)) {
    if (existsSync(join(projectDir, marker))) {
      context.testFramework = framework;
      break;
    }
  }

  // Detect package manager
  for (const [lockfile, manager] of Object.entries(PACKAGE_MANAGERS)) {
    if (existsSync(join(projectDir, lockfile))) {
      context.packageManager = manager;
      break;
    }
  }

  return context;
}

// ─── System Prompt Injection ────────────────────────────────────

export function buildCodingContextBlock(context: CodingContext): string {
  if (!context.isCoding) return '';

  const lines: string[] = [];
  lines.push('## Workspace Context');
  lines.push('');

  if (context.gitBranch) {
    lines.push(`- Git branch: \`${context.gitBranch}\`${context.gitDirty ? ' (dirty)' : ' (clean)'}`);
  }
  if (context.language) {
    lines.push(`- Language: ${context.language}`);
  }
  if (context.testFramework) {
    lines.push(`- Test framework: ${context.testFramework}`);
  }
  if (context.packageManager) {
    lines.push(`- Package manager: ${context.packageManager}`);
  }

  lines.push('');
  lines.push('When making changes:');
  lines.push('- Match the existing code style');
  lines.push('- Run tests after changes');
  lines.push('- Use the project\'s package manager for dependency operations');

  return lines.join('\n');
}

// ─── Language-Specific Hints ────────────────────────────────────

export function getLanguageHints(language: string | null): string {
  if (!language) return '';

  const hints: Record<string, string> = {
    typescript: 'Use TypeScript strict mode. Prefer interfaces over types. Use `as const` assertions where appropriate.',
    python: 'Use type hints. Follow PEP 8. Prefer pathlib over os.path. Use f-strings.',
    rust: 'Use `Result<T, E>` for error handling. Prefer iterators over loops. Use `clippy` suggestions.',
    go: 'Handle all errors explicitly. Use `context.Context` for cancellation. Prefer composition over inheritance.',
    java: 'Use records for data classes. Prefer streams over loops. Use Optional for nullable returns.',
    ruby: 'Use Ruby 3+ syntax. Prefer frozen_string_literal. Use keyword arguments.',
  };

  return hints[language] || '';
}
