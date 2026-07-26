/**
 * Codebase index — file indexing and search for code navigation.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface CodebaseIndexOptions {
  root: string;
  maxFileSize?: number;
  ignorePatterns?: string[];
  includeExtensions?: string[];
}

export interface IndexedFile {
  path: string;
  size: number;
  extension: string;
  lastModified: Date;
}

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  text: string;
}

export interface Definition {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'module';
  file: string;
  line: number;
  column: number;
}

export interface Reference {
  file: string;
  line: number;
  column: number;
  text: string;
}

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1MB
const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', 'vendor', 'target',
];
const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go',
  '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.swift', '.kt', '.scala',
];

/**
 * CodebaseIndex — indexes project files for fast code navigation.
 */
export class CodebaseIndex {
  private root: string;
  private files: Map<string, IndexedFile> = new Map();
  private maxFileSize: number;
  private ignorePatterns: string[];
  private includeExtensions: string[];
  private indexed = false;

  constructor(options: CodebaseIndexOptions) {
    this.root = options.root;
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.ignorePatterns = options.ignorePatterns ?? DEFAULT_IGNORE;
    this.includeExtensions = options.includeExtensions ?? DEFAULT_EXTENSIONS;
  }

  /**
   * Build the file index by walking the directory tree.
   */
  async buildIndex(onProgress?: (count: number) => void): Promise<void> {
    this.files.clear();
    await this.walkDir(this.root, 0, onProgress);
    this.indexed = true;
  }

  private async walkDir(
    dir: string,
    depth: number,
    onProgress?: (count: number) => void
  ): Promise<void> {
    if (depth > 20) return; // Prevent infinite recursion

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip ignored patterns
        if (this.ignorePatterns.includes(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;

        if (entry.isDirectory()) {
          await this.walkDir(fullPath, depth + 1, onProgress);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!this.includeExtensions.includes(ext)) continue;

          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > this.maxFileSize) continue;

            const relativePath = path.relative(this.root, fullPath);
            this.files.set(relativePath, {
              path: relativePath,
              size: stat.size,
              extension: ext,
              lastModified: stat.mtime,
            });

            onProgress?.(this.files.size);
          } catch { /* skip inaccessible files */ }
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  /**
   * Get all indexed files.
   */
  getFiles(): IndexedFile[] {
    return Array.from(this.files.values());
  }

  /**
   * Get file count.
   */
  getFileCount(): number {
    return this.files.size;
  }

  /**
   * Search for files matching a pattern.
   */
  searchFiles(pattern: string): IndexedFile[] {
    const regex = new RegExp(pattern, 'i');
    return this.getFiles().filter(f => regex.test(f.path));
  }

  /**
   * Get index stats.
   */
  getStats(): { fileCount: number; totalSize: number; extensions: Map<string, number> } {
    let totalSize = 0;
    const extensions = new Map<string, number>();

    for (const file of this.files.values()) {
      totalSize += file.size;
      extensions.set(file.extension, (extensions.get(file.extension) || 0) + 1);
    }

    return { fileCount: this.files.size, totalSize, extensions };
  }

  /**
   * Check if the index has been built.
   */
  isIndexed(): boolean {
    return this.indexed;
  }
}
