/**
 * Memory providers — external memory provider integration.
 */

export interface MemoryProvider {
  name: string;
  type: 'local' | 'remote' | 'cloud';
  enabled: boolean;
  config: Record<string, unknown>;
}

// Registered memory providers
const providers = new Map<string, MemoryProvider>();

/**
 * Register a memory provider.
 */
export function registerMemoryProvider(provider: MemoryProvider): void {
  providers.set(provider.name, provider);
}

/**
 * Get a memory provider by name.
 */
export function getMemoryProvider(name: string): MemoryProvider | undefined {
  return providers.get(name);
}

/**
 * Get all memory providers.
 */
export function getAllMemoryProviders(): MemoryProvider[] {
  return [...providers.values()];
}

/**
 * Get enabled memory providers.
 */
export function getEnabledMemoryProviders(): MemoryProvider[] {
  return [...providers.values()].filter(p => p.enabled);
}

/**
 * Enable/disable a memory provider.
 */
export function toggleMemoryProvider(name: string, enabled: boolean): boolean {
  const provider = providers.get(name);
  if (!provider) return false;
  provider.enabled = enabled;
  return true;
}

/**
 * Format memory providers for display.
 */
export function formatMemoryProviders(): string {
  const all = getAllMemoryProviders();
  if (all.length === 0) return 'No memory providers registered.';
  return all.map(p => {
    const icon = p.enabled ? '✅' : '⏸️';
    return `${icon} ${p.name} (${p.type})`;
  }).join('\n');
}
