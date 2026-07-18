/**
 * File tree generation for project overview.
 *
 * Generates a tree representation of the project structure
 * with extension summaries and size information.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileTreeOptions {
  maxCharacters?: number;
  maxDepth?: number;
  maxDirsVisited?: number;
  includeHidden?: boolean;
  excludePatterns?: string[];
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: FileTreeNode[];
  extension?: string;
}

export interface FileTreeResult {
  root: FileTreeNode;
  totalFiles: number;
  totalDirs: number;
  truncated: boolean;
  extensionSummary: Map<string, number>;
}

const DEFAULT_MAX_CHARACTERS = 10_000;
const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_DIRS_VISITED = 2000;

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'target', '__pycache__', '.next', 'dist',
  'build', '.cache', '.parcel-cache', 'coverage', '.nyc_output',
]);

/**
 * Get top N extensions by count.
 */
function getTopExts(files: string[], k: number = 3): [string, number][] {
  const extCounts = new Map<string, number>();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || '(no-ext)';
    extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
  }
  return Array.from(extCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);
}

/**
 * Generate a file tree for a directory.
 */
export function generateFileTree(
  rootPath: string,
  options: FileTreeOptions = {}
): FileTreeResult {
  const maxChars = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxDirs = options.maxDirsVisited ?? DEFAULT_MAX_DIRS_VISITED;

  let totalFiles = 0;
  let totalDirs = 0;
  let truncated = false;
  let totalChars = 0;
  let dirsVisited = 0;
  const allFiles: string[] = [];

  function buildTree(dirPath: string, depth: number): FileTreeNode | null {
    if (depth > maxDepth || dirsVisited >= maxDirs) {
      truncated = true;
      return null;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return null;
    }

    dirsVisited++;

    const children: FileTreeNode[] = [];
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (!options.includeHidden && entry.name.startsWith('.')) continue;
      if (EXCLUDE_DIRS.has(entry.name)) continue;

      if (options.excludePatterns?.some(p => entry.name.includes(p))) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(rootPath, fullPath);
      const nameDisplay = `${entry.name}${entry.isDirectory() ? '/' : ''}`;

      if (totalChars + nameDisplay.length + 2 > maxChars) {
        truncated = true;
        break;
      }

      if (entry.isDirectory()) {
        totalDirs++;
        totalChars += nameDisplay.length + 1;
        const child = buildTree(fullPath, depth + 1);
        if (child) children.push(child);
      } else {
        totalFiles++;
        allFiles.push(fullPath);
        const stat = fs.statSync(fullPath);
        totalChars += nameDisplay.length + 1;
        children.push({
          name: entry.name,
          path: relPath,
          isDirectory: false,
          size: stat.size,
          extension: path.extname(entry.name).toLowerCase(),
        });
      }
    }

    return {
      name: path.basename(dirPath),
      path: path.relative(rootPath, dirPath) || '.',
      isDirectory: true,
      children,
    };
  }

  const root = buildTree(rootPath, 0);

  // Build extension summary
  const extensionSummary = new Map<string, number>();
  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase() || '(no-ext)';
    extensionSummary.set(ext, (extensionSummary.get(ext) || 0) + 1);
  }

  return { root: root!, totalFiles, totalDirs, truncated, extensionSummary };
}

/**
 * Render a file tree as a string.
 */
export function renderFileTree(node: FileTreeNode, prefix: string = '', isLast: boolean = true): string {
  const lines: string[] = [];
  const connector = isLast ? '└── ' : '├── ';
  const sizeStr = node.size !== undefined ? ` (${formatSize(node.size)})` : '';
  lines.push(`${prefix}${connector}${node.name}${sizeStr}`);

  if (node.children) {
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    node.children.forEach((child, i) => {
      lines.push(renderFileTree(child, childPrefix, i === node.children!.length - 1));
    });
  }

  return lines.join('\n');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
