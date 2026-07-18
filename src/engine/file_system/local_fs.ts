/**
 * Local filesystem — AsyncFileSystem implementation for local paths.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface AsyncFileSystem {
  root(): string;
  exists(filePath: string): Promise<boolean>;
  readFile(filePath: string): Promise<Buffer>;
  tryReadFile(filePath: string): Promise<Buffer | null>;
  writeFile(filePath: string, data: Buffer | string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
}

export class LocalFs implements AsyncFileSystem {
  private rootPath: string;

  constructor(root: string) {
    this.rootPath = root;
  }

  root(): string {
    return this.rootPath;
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  async tryReadFile(filePath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }
}
