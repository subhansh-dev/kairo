/**
 * Trust store — persists per-folder trust decisions.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export const TRUST_FILE_NAME = 'trusted_folders.toml';

export interface FolderTrust {
  trusted: boolean;
  decidedAt?: number;
}

export interface TrustDocument {
  folders: Record<string, FolderTrust>;
}

export class TrustStore {
  private doc: TrustDocument;
  private filePath: string | null;

  private constructor(doc: TrustDocument, filePath: string | null) {
    this.doc = doc;
    this.filePath = filePath;
  }

  static load(): TrustStore {
    const defaultPath = TrustStore.defaultPath();
    if (!defaultPath) return TrustStore.empty();
    return TrustStore.loadFrom(defaultPath);
  }

  static loadFrom(filePath: string): TrustStore {
    // Synchronous load for simplicity
    try {
      const content = require('fs').readFileSync(filePath, 'utf-8');
      const doc = TrustStore.parseToml(content);
      return new TrustStore(doc, filePath);
    } catch {
      return new TrustStore({ folders: {} }, filePath);
    }
  }

  static empty(): TrustStore {
    return new TrustStore({ folders: {} }, null);
  }

  static defaultPath(): string | null {
    const grokHome = process.env.GROK_HOME || path.join(os.homedir(), '.grok');
    if (!grokHome) return null;
    return path.join(grokHome, TRUST_FILE_NAME);
  }

  isTrusted(folderPath: string): boolean {
    const key = TrustStore.normalizeKey(folderPath);
    // Longest prefix match
    let bestMatch = '';
    let bestTrust = false;

    for (const [storedPath, record] of Object.entries(this.doc.folders)) {
      if (key.startsWith(storedPath) || storedPath.startsWith(key)) {
        if (storedPath.length > bestMatch.length) {
          bestMatch = storedPath;
          bestTrust = record.trusted;
        }
      }
    }

    return bestTrust;
  }

  setTrusted(folderPath: string, trusted: boolean): void {
    const key = TrustStore.normalizeKey(folderPath);
    this.doc.folders[key] = {
      trusted,
      decidedAt: Math.floor(Date.now() / 1000),
    };
  }

  async persist(): Promise<void> {
    if (!this.filePath) return;

    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const content = TrustStore.serializeToml(this.doc);
    await fs.writeFile(this.filePath, content, { mode: 0o600 });
  }

  private static normalizeKey(folderPath: string): string {
    return path.resolve(folderPath);
  }

  private static parseToml(content: string): TrustDocument {
    // Simple TOML parser for trusted_folders.toml
    const doc: TrustDocument = { folders: {} };
    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const sectionMatch = trimmed.match(/^\[folders\."?([^"]+)"?\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        continue;
      }

      if (currentSection) {
        const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
        if (kvMatch) {
          const [, key, value] = kvMatch;
          if (!doc.folders[currentSection]) {
            doc.folders[currentSection] = { trusted: false };
          }
          if (key === 'trusted') {
            doc.folders[currentSection].trusted = value === 'true';
          } else if (key === 'decided_at') {
            doc.folders[currentSection].decidedAt = parseInt(value, 10);
          }
        }
      }
    }

    return doc;
  }

  private static serializeToml(doc: TrustDocument): string {
    const lines: string[] = [];
    for (const [folder, record] of Object.entries(doc.folders)) {
      lines.push(`[folders."${folder}"]`);
      lines.push(`trusted = ${record.trusted}`);
      if (record.decidedAt) {
        lines.push(`decided_at = ${record.decidedAt}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
}

export function workspaceKey(cwd: string): string {
  return path.resolve(cwd);
}

export function isHomeDir(filePath: string): boolean {
  const home = os.homedir();
  return path.resolve(filePath) === path.resolve(home);
}

export function isUnsafeTrustRoot(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  return (
    resolved === path.resolve(home) ||
    resolved === '/' ||
    resolved === path.parse(resolved).root ||
    !path.isAbsolute(resolved)
  );
}
