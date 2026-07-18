/**
 * Session-scoped file storage with crash-safe atomic writes and budgets.
 *
 * Each SessionFileWriter manages a single subdirectory and file extension,
 * producing files named 1.jpg, 2.mp4, 3.pdf, etc.
 * The counter is lazily initialized from existing files on disk so
 * resumed sessions don't overwrite previous output.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const IMAGE_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

function budgetFor(dirName: string): number {
  switch (dirName) {
    case 'images': return IMAGE_MAX_BYTES;
    case 'videos': return VIDEO_MAX_BYTES;
    default: return DEFAULT_MAX_BYTES;
  }
}

export class SessionFileWriter {
  private dirName: string;
  private ext: string;
  private counter = 0;
  private bytesWritten = 0;
  private maxTotalBytes: number;
  private initialized = false;

  constructor(dirName: string, ext: string) {
    this.dirName = dirName;
    this.ext = ext;
    this.maxTotalBytes = budgetFor(dirName);
  }

  /**
   * Save bytes to the next numbered file, returning the absolute path.
   * extOverride writes a different file type without needing a separate writer.
   */
  async save(
    sessionFolder: string,
    bytes: Buffer,
    extOverride?: string
  ): Promise<string> {
    const dir = path.join(sessionFolder, this.dirName);

    await fs.mkdir(dir, { recursive: true });

    // Lazy-init: scan existing files for counter resume + byte accounting
    if (!this.initialized) {
      const stats = await scanDirStats(dir);
      this.counter = stats.maxN;
      this.bytesWritten = stats.totalBytes;
      this.initialized = true;
    }

    const n = ++this.counter;
    const size = bytes.length;
    const newTotal = this.bytesWritten + size;

    if (newTotal > this.maxTotalBytes) {
      this.counter--;
      throw new Error(
        `byte budget exceeded: ${newTotal}/${this.maxTotalBytes} bytes in ${this.dirName}`
      );
    }

    const ext = extOverride || this.ext;
    const filePath = path.join(dir, `${n}.${ext}`);

    // Atomic write: tempfile -> fsync -> rename
    const tmpPath = path.join(dir, `.tmp${Date.now()}-${n}`);
    try {
      await fs.writeFile(tmpPath, bytes);
      const fd = await fs.open(tmpPath, 'r');
      try {
        await fd.sync();
      } finally {
        await fd.close();
      }
      await fs.rename(tmpPath, filePath);
    } catch (e) {
      this.counter--;
      // Try cleanup
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
      throw e;
    }

    this.bytesWritten = newTotal;
    return filePath;
  }

  getStats(): { counter: number; bytesWritten: number; maxBytes: number } {
    return {
      counter: this.counter,
      bytesWritten: this.bytesWritten,
      maxBytes: this.maxTotalBytes,
    };
  }
}

interface DirStats {
  maxN: number;
  totalBytes: number;
}

async function scanDirStats(dir: string): Promise<DirStats> {
  let maxN = 0;
  let totalBytes = 0;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const name = entry.name;

      // Remove orphan temp files from interrupted writes
      if (name.startsWith('.tmp')) {
        try { await fs.unlink(path.join(dir, name)); } catch { /* ignore */ }
        continue;
      }

      // Track the highest numbered file
      const dotIdx = name.indexOf('.');
      if (dotIdx > 0) {
        const stem = name.substring(0, dotIdx);
        const n = parseInt(stem, 10);
        if (!isNaN(n) && n > maxN) {
          maxN = n;
        }
      }

      // Sum bytes for budget init
      try {
        const stat = await fs.stat(path.join(dir, name));
        totalBytes += stat.size;
      } catch { /* ignore */ }
    }
  } catch { /* dir doesn't exist yet */ }

  return { maxN, totalBytes };
}

/**
 * Ensure a session folder exists and return its path.
 */
export function ensureSessionFolder(sessionId: string, baseDir?: string): string {
  const base = baseDir || path.join(os.tmpdir(), 'kairo-sessions');
  const folder = path.join(base, sessionId);
  return folder;
}
