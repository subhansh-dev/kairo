/**
 * Migrate — migration utilities for Kairo.
 */

export interface MigrationResult {
  success: boolean;
  migrated: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Check if migration from another tool is possible.
 */
export function detectMigrationSources(): Array<{ name: string; path: string; found: boolean }> {
  const { homedir } = require('os');
  const { existsSync } = require('fs');
  const { join } = require('path');
  const home = homedir();

  const sources = [
    { name: 'OpenClaw', path: join(home, '.openclaw') },
    { name: 'Claude Code', path: join(home, '.claude') },
    { name: 'Aider', path: join(home, '.aider') },
    { name: 'Continue', path: join(home, '.continue') },
  ];

  return sources.map(s => ({
    ...s,
    found: existsSync(s.path),
  }));
}

/**
 * Migrate settings from OpenClaw.
 */
export function migrateFromOpenClaw(): MigrationResult {
  const { homedir } = require('os');
  const { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } = require('fs');
  const { join } = require('path');

  const result: MigrationResult = { success: true, migrated: [], skipped: [], errors: [] };
  const sourceDir = join(homedir(), '.openclaw');
  const targetDir = join(homedir(), '.kairo');

  if (!existsSync(sourceDir)) {
    result.success = false;
    result.errors.push('OpenClaw directory not found');
    return result;
  }

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  // Migrate config files
  const filesToMigrate = ['models.yml', 'config.yaml'];
  for (const file of filesToMigrate) {
    const source = join(sourceDir, file);
    const target = join(targetDir, file);
    if (existsSync(source) && !existsSync(target)) {
      try {
        copyFileSync(source, target);
        result.migrated.push(file);
      } catch (err: any) {
        result.errors.push(`Failed to migrate ${file}: ${err.message}`);
      }
    } else {
      result.skipped.push(file);
    }
  }

  return result;
}

/**
 * Format migration results for display.
 */
export function formatMigrationResult(result: MigrationResult): string {
  const lines = [];

  if (result.migrated.length > 0) {
    lines.push('✅ Migrated:');
    for (const f of result.migrated) lines.push(`  • ${f}`);
  }

  if (result.skipped.length > 0) {
    lines.push('⏭️  Skipped (already exists):');
    for (const f of result.skipped) lines.push(`  • ${f}`);
  }

  if (result.errors.length > 0) {
    lines.push('❌ Errors:');
    for (const e of result.errors) lines.push(`  • ${e}`);
  }

  return lines.join('\n') || 'Nothing to migrate.';
}
