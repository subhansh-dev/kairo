/**
 * Backup — backup and restore utilities.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface BackupManifest {
  id: string;
  createdAt: number;
  description?: string;
  files: string[];
}

const BACKUP_DIR = join(homedir(), '.kairo', 'backups');

/**
 * Create a backup of the Kairo config directory.
 */
export function createBackup(description?: string): BackupManifest | null {
  try {
    const sourceDir = join(homedir(), '.kairo');
    if (!existsSync(sourceDir)) return null;

    const backupId = `backup_${Date.now()}`;
    const backupPath = join(BACKUP_DIR, backupId);
    if (!existsSync(backupPath)) mkdirSync(backupPath, { recursive: true });

    const files: string[] = [];
    const configFiles = ['config.yaml', 'models.yml', 'mcp-servers.json', 'skills-config.json'];
    for (const file of configFiles) {
      const source = join(sourceDir, file);
      if (existsSync(source)) {
        const { copyFileSync } = require('fs');
        copyFileSync(source, join(backupPath, file));
        files.push(file);
      }
    }

    const manifest: BackupManifest = {
      id: backupId,
      createdAt: Date.now(),
      description,
      files,
    };
    writeFileSync(join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    return manifest;
  } catch {
    return null;
  }
}

/**
 * List available backups.
 */
export function listBackups(): BackupManifest[] {
  try {
    if (!existsSync(BACKUP_DIR)) return [];
    const dirs = readdirSync(BACKUP_DIR).filter(d => d.startsWith('backup_'));
    return dirs.map(d => {
      try {
        const manifestPath = join(BACKUP_DIR, d, 'manifest.json');
        if (existsSync(manifestPath)) return JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch { /* ok */ }
      return null;
    }).filter(Boolean) as BackupManifest[];
  } catch {
    return [];
  }
}

/**
 * Restore a backup.
 */
export function restoreBackup(backupId: string): boolean {
  try {
    const backupPath = join(BACKUP_DIR, backupId);
    if (!existsSync(backupPath)) return false;

    const manifest: BackupManifest = JSON.parse(readFileSync(join(backupPath, 'manifest.json'), 'utf-8'));
    const targetDir = join(homedir(), '.kairo');
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

    for (const file of manifest.files) {
      const { copyFileSync } = require('fs');
      copyFileSync(join(backupPath, file), join(targetDir, file));
    }

    return true;
  } catch {
    return false;
  }
}
