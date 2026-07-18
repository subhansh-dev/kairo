/**
 * Memory setup — memory system initialization.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const MEMORY_DIR = join(homedir(), '.kairo', 'memories');

/**
 * Initialize the memory system.
 */
export function initMemorySystem(): { created: string[]; errors: string[] } {
  const created: string[] = [];
  const errors: string[] = [];

  // Create memory directory
  if (!existsSync(MEMORY_DIR)) {
    try {
      mkdirSync(MEMORY_DIR, { recursive: true });
      created.push(MEMORY_DIR);
    } catch (err: any) {
      errors.push(`Failed to create ${MEMORY_DIR}: ${err.message}`);
    }
  }

  // Create default memory files
  const defaultFiles = ['MEMORY.md', 'USER.md'];
  for (const file of defaultFiles) {
    const path = join(MEMORY_DIR, file);
    if (!existsSync(path)) {
      try {
        writeFileSync(path, `# ${file.replace('.md', '')}\n\n`, 'utf-8');
        created.push(path);
      } catch (err: any) {
        errors.push(`Failed to create ${path}: ${err.message}`);
      }
    }
  }

  return { created, errors };
}

/**
 * Check if memory system is initialized.
 */
export function isMemoryInitialized(): boolean {
  return existsSync(MEMORY_DIR);
}

/**
 * Get the memory directory path.
 */
export function getMemoryDir(): string {
  return MEMORY_DIR;
}

/**
 * Format memory setup results for display.
 */
export function formatMemorySetup(result: { created: string[]; errors: string[] }): string {
  const lines = [];
  if (result.created.length > 0) {
    lines.push('Created:');
    for (const f of result.created) lines.push(`  • ${f}`);
  }
  if (result.errors.length > 0) {
    lines.push('Errors:');
    for (const e of result.errors) lines.push(`  • ${e}`);
  }
  return lines.join('\n') || 'Memory system already initialized.';
}
