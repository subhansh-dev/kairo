/**
 * Kairo — Context Assembly Pipeline
 * Intelligently assembles context for the model based on the task.
 * Auto-injects relevant files, git context, project structure.
 * 
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { execSync } from 'child_process';

interface ContextPiece {
  source: string;
  content: string;
  priority: number; // higher = more important
  tokenEstimate: number;
}

const FILE_RELEVANCE_MAP: Record<string, string[]> = {
  'package.json': ['dependencies', 'scripts', 'project type'],
  'tsconfig.json': ['TypeScript config', 'compiler options'],
  'pyproject.toml': ['Python project', 'dependencies'],
  'Cargo.toml': ['Rust project', 'dependencies'],
  'go.mod': ['Go project', 'dependencies'],
  '.gitignore': ['ignored files', 'project structure'],
  'README.md': ['project overview', 'documentation'],
  'Makefile': ['build commands', 'project structure'],
};

/**
 * Estimate tokens (1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf-8') / 4);
}

/**
 * Get recently modified files in the project.
 */
function getRecentFiles(projectDir: string, limit: number = 10): string[] {
  try {
    const output = execSync(
      `git log --name-only --pretty=format: -${limit * 2} 2>/dev/null | sort -u | head -${limit}`,
      { cwd: projectDir, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get git status for context.
 */
function getGitStatus(projectDir: string): string {
  try {
    const status = execSync('git status --short 2>/dev/null', {
      cwd: projectDir, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
      cwd: projectDir, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return `Branch: ${branch}\n${status}`;
  } catch {
    return '';
  }
}

/**
 * Get project structure overview.
 */
function getProjectStructure(projectDir: string, maxDepth: number = 2): string {
  try {
    const output = execSync(
      `find . -maxdepth ${maxDepth} -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './dist/*' -not -path './.next/*' | head -50`,
      { cwd: projectDir, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim();
  } catch {
    return '';
  }
}

/**
 * Assemble context for a given task.
 * Returns pieces sorted by priority, fitting within token budget.
 */
export function assembleContext(
  task: string,
  projectDir: string,
  maxTokens: number = 8000,
): string {
  const pieces: ContextPiece[] = [];

  // 1. Project config files (high priority)
  for (const [file, relevance] of Object.entries(FILE_RELEVANCE_MAP)) {
    const path = join(projectDir, file);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        // Truncate large files
        const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n...[truncated]' : content;
        pieces.push({
          source: file,
          content: `# ${file} (${relevance.join(', ')})\n${truncated}`,
          priority: 8,
          tokenEstimate: estimateTokens(truncated),
        });
      } catch {}
    }
  }

  // 2. Git status (medium priority)
  const gitStatus = getGitStatus(projectDir);
  if (gitStatus) {
    pieces.push({
      source: 'git-status',
      content: `# Git Status\n${gitStatus}`,
      priority: 6,
      tokenEstimate: estimateTokens(gitStatus),
    });
  }

  // 3. Recently modified files (medium priority)
  const recentFiles = getRecentFiles(projectDir);
  if (recentFiles.length > 0) {
    const recentContent = recentFiles
      .map(f => {
        const path = join(projectDir, f);
        if (existsSync(path)) {
          try {
            const stat = statSync(path);
            return `  ${f} (${(stat.size / 1024).toFixed(1)}KB, ${new Date(stat.mtimeMs).toISOString()})`;
          } catch {
            return `  ${f}`;
          }
        }
        return null;
      })
      .filter(Boolean)
      .join('\n');

    pieces.push({
      source: 'recent-files',
      content: `# Recently Modified Files\n${recentContent}`,
      priority: 5,
      tokenEstimate: estimateTokens(recentContent),
    });
  }

  // 4. Project structure (lower priority)
  const structure = getProjectStructure(projectDir);
  if (structure) {
    pieces.push({
      source: 'project-structure',
      content: `# Project Structure\n${structure}`,
      priority: 3,
      tokenEstimate: estimateTokens(structure),
    });
  }

  // Sort by priority (highest first) and fit within budget
  pieces.sort((a, b) => b.priority - a.priority);

  let totalTokens = 0;
  const selected: ContextPiece[] = [];
  for (const piece of pieces) {
    if (totalTokens + piece.tokenEstimate > maxTokens) break;
    selected.push(piece);
    totalTokens += piece.tokenEstimate;
  }

  return selected.map(p => p.content).join('\n\n---\n\n');
}
