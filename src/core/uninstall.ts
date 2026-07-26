/**
 * Uninstall — uninstall utilities.
 */

import { existsSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface UninstallResult {
  removed: string[];
  errors: string[];
}

/**
 * Uninstall Kairo (remove config and data files).
 */
export function uninstallKairo(opts: { keepConfig?: boolean; keepData?: boolean } = {}): UninstallResult {
  const result: UninstallResult = { removed: [], errors: [] };
  const home = homedir();
  const kairoDir = join(home, '.kairo');

  if (!existsSync(kairoDir)) {
    result.removed.push('Nothing to remove (no .kairo directory)');
    return result;
  }

  try {
    if (!opts.keepConfig) {
      const configFiles = ['config.yaml', 'models.yml', 'mcp-servers.json'];
      for (const file of configFiles) {
        const path = join(kairoDir, file);
        if (existsSync(path)) {
          try {
            unlinkSync(path);
            result.removed.push(file);
          } catch (err: any) {
            result.errors.push(`Failed to remove ${file}: ${err.message}`);
          }
        }
      }
    }

    if (!opts.keepData) {
      const dataDirs = ['sessions', 'memories', 'skills', 'tool-results', 'logs'];
      for (const dir of dataDirs) {
        const path = join(kairoDir, dir);
        if (existsSync(path)) {
          try {
            const files = readdirSync(path);
            for (const file of files) {
              unlinkSync(join(path, file));
            }
            rmdirSync(path);
            result.removed.push(`${dir}/`);
          } catch (err: any) {
            result.errors.push(`Failed to remove ${dir}: ${err.message}`);
          }
        }
      }
    }
  } catch (err: any) {
    result.errors.push(err.message);
  }

  return result;
}

/**
 * Format uninstall results for display.
 */
export function formatUninstallResult(result: UninstallResult): string {
  const lines = [];

  if (result.removed.length > 0) {
    lines.push('Removed:');
    for (const r of result.removed) lines.push(`  • ${r}`);
  }

  if (result.errors.length > 0) {
    lines.push('Errors:');
    for (const e of result.errors) lines.push(`  • ${e}`);
  }

  return lines.join('\n') || 'Nothing to remove.';
}
