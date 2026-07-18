/**
 * Runtime provider — runtime provider management.
 */

export interface RuntimeProvider {
  id: string;
  name: string;
  type: 'local' | 'cloud' | 'hybrid';
  enabled: boolean;
  config: Record<string, unknown>;
}

// Registered runtime providers
const providers = new Map<string, RuntimeProvider>();

/**
 * Register a runtime provider.
 */
export function registerRuntimeProvider(provider: RuntimeProvider): void {
  providers.set(provider.id, provider);
}

/**
 * Get a runtime provider by ID.
 */
export function getRuntimeProvider(id: string): RuntimeProvider | undefined {
  return providers.get(id);
}

/**
 * Get all runtime providers.
 */
export function getAllRuntimeProviders(): RuntimeProvider[] {
  return [...providers.values()];
}

/**
 * Get enabled runtime providers.
 */
export function getEnabledRuntimeProviders(): RuntimeProvider[] {
  return [...providers.values()].filter(p => p.enabled);
}

/**
 * Enable/disable a runtime provider.
 */
export function toggleRuntimeProvider(id: string, enabled: boolean): boolean {
  const provider = providers.get(id);
  if (!provider) return false;
  provider.enabled = enabled;
  return true;
}

/**
 * Format runtime providers for display.
 */
export function formatRuntimeProviders(): string {
  const all = getAllRuntimeProviders();
  if (all.length === 0) return 'No runtime providers registered.';
  return all.map(p => {
    const icon = p.enabled ? '✅' : '⏸️';
    return `${icon} ${p.name} (${p.type})`;
  }).join('\n');
}
