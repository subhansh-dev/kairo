/**
 * Kairo — Curator Backup
 * Snapshot + rollback for skills directory.
 * Ported from Hermes Agent's curator_backup.py
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const BACKUP_DIR = join(homedir(), '.kairo', 'skill-backups');

// ─── Types ──────────────────────────────────────────────────────

export interface BackupManifest {
  id: string;
  timestamp: number;
  reason: string;
  fileCount: number;
  sizeBytes: number;
}

// ─── Backup Operations ──────────────────────────────────────────

/**
 * Create a snapshot of the skills directory.
 */
export function createBackup(reason: string = 'manual'): BackupManifest | null {
  const skillsDir = join(homedir(), '.kairo', 'skills');
  if (!existsSync(skillsDir)) return null;

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(BACKUP_DIR, id);
  mkdirSync(backupPath, { recursive: true });

  // Copy skills
  let fileCount = 0;
  let sizeBytes = 0;
  const entries = readdirSync(skillsDir);
  for (const entry of entries) {
    if (entry === '.curator_backups' || entry === 'backups') continue;
    const src = join(skillsDir, entry);
    const dst = join(backupPath, entry);
    try {
      const stat = statSync(src);
      if (stat.isFile()) {
        copyFileSync(src, dst);
        fileCount++;
        sizeBytes += stat.size;
      } else if (stat.isDirectory()) {
        execSync(`cp -r "${src}" "${dst}"`, { stdio: 'pipe' });
        fileCount++;
      }
    } catch {}
  }

  // Write manifest
  const manifest: BackupManifest = { id, timestamp: Date.now(), reason, fileCount, sizeBytes };
  writeFileSync(join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  return manifest;
}

/**
 * List available backups.
 */
export function listBackups(): BackupManifest[] {
  if (!existsSync(BACKUP_DIR)) return [];

  const manifests: BackupManifest[] = [];
  for (const entry of readdirSync(BACKUP_DIR)) {
    const manifestPath = join(BACKUP_DIR, entry, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        manifests.push(JSON.parse(readFileSync(manifestPath, 'utf-8')));
      } catch {}
    }
  }

  return manifests.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Restore a backup.
 */
export function restoreBackup(backupId: string): boolean {
  const backupPath = join(BACKUP_DIR, backupId);
  if (!existsSync(backupPath)) return false;

  const skillsDir = join(homedir(), '.kairo', 'skills');

  // Create backup of current state first
  createBackup('pre-restore');

  // Restore
  try {
    execSync(`rm -rf "${skillsDir}"/* && cp -r "${backupPath}"/* "${skillsDir}/"`, { stdio: 'pipe' });
    // Remove manifest from restored skills
    const manifestInSkills = join(skillsDir, 'manifest.json');
    if (existsSync(manifestInSkills)) {
      const { unlinkSync } = require('fs');
      unlinkSync(manifestInSkills);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean old backups (keep last N).
 */
export function cleanBackups(keep: number = 10): number {
  const backups = listBackups();
  if (backups.length <= keep) return 0;

  let removed = 0;
  for (const backup of backups.slice(keep)) {
    const path = join(BACKUP_DIR, backup.id);
    try {
      execSync(`rm -rf "${path}"`, { stdio: 'pipe' });
      removed++;
    } catch {}
  }
  return removed;
}
