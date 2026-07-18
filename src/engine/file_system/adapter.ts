/**
 * File system adapter — unified file access interface.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface FileSystemAdapter {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  stat(filePath: string): Promise<FileInfo>;
  readdir(dirPath: string): Promise<DirEntry[]>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
  rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface FileInfo {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  modifiedAt: Date;
  createdAt: Date;
}

export interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  path: string;
}

/**
 * Local filesystem adapter using Node.js fs module.
 */
export class LocalFileSystemAdapter implements FileSystemAdapter {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  private resolve(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(this.root, filePath);
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(this.resolve(filePath), 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = this.resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  }

  async stat(filePath: string): Promise<FileInfo> {
    const s = await fs.stat(this.resolve(filePath));
    return {
      size: s.size,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      isSymlink: s.isSymbolicLink(),
      modifiedAt: s.mtime,
      createdAt: s.birthtime,
    };
  }

  async readdir(dirPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(this.resolve(dirPath), { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'symlink',
      path: path.join(dirPath, e.name),
    }));
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(this.resolve(dirPath), options);
  }

  async rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await fs.rm(this.resolve(filePath), options);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(this.resolve(oldPath), this.resolve(newPath));
  }
}
