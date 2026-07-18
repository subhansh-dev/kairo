/**
 * Context references — track context file references.
 */

export interface ContextReference {
  path: string;
  type: 'skill' | 'memory' | 'config' | 'context' | 'tool';
  name?: string;
  loadedAt: number;
  size: number;
}

// Track loaded context references
const references: ContextReference[] = [];

/**
 * Record a context reference.
 */
export function recordContextReference(ref: ContextReference): void {
  references.push(ref);
}

/**
 * Get all context references.
 */
export function getContextReferences(): ContextReference[] {
  return [...references];
}

/**
 * Get references by type.
 */
export function getContextReferencesByType(type: ContextReference['type']): ContextReference[] {
  return references.filter(r => r.type === type);
}

/**
 * Get total size of all loaded context.
 */
export function getTotalContextSize(): number {
  return references.reduce((sum, r) => sum + r.size, 0);
}

/**
 * Clear all context references.
 */
export function clearContextReferences(): void {
  references.length = 0;
}

/**
 * Format context references for display.
 */
export function formatContextReferences(): string {
  if (references.length === 0) return 'No context loaded.';

  const byType = new Map<string, ContextReference[]>();
  for (const ref of references) {
    const existing = byType.get(ref.type) || [];
    existing.push(ref);
    byType.set(ref.type, existing);
  }

  const lines: string[] = [];
  for (const [type, refs] of byType) {
    const totalSize = refs.reduce((sum, r) => sum + r.size, 0);
    lines.push(`${type}: ${refs.length} files (${formatSize(totalSize)})`);
  }

  return lines.join('\n');
}

/**
 * Format file size for display.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
