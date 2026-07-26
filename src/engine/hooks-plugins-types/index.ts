/**
 * Hooks plugins types — type definitions for hook plugin system.
 */

export type HookPluginType = 'command' | 'http' | 'inline';

export interface HookPlugin {
  name: string;
  type: HookPluginType;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface HookPluginManifest {
  name: string;
  type: HookPluginType;
  version: string;
  description: string;
  author?: string;
  entryPoint: string;
  permissions: string[];
  config?: Record<string, unknown>;
}

/**
 * Create a hook plugin from a manifest.
 */
export function createHookPlugin(manifest: HookPluginManifest): HookPlugin {
  return {
    name: manifest.name,
    type: manifest.type,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    enabled: true,
    config: manifest.config ?? {},
  };
}

/**
 * Validate a hook plugin manifest.
 */
export function validateHookPluginManifest(manifest: HookPluginManifest): string[] {
  const errors: string[] = [];
  if (!manifest.name) errors.push('Plugin name is required');
  if (!manifest.version) errors.push('Plugin version is required');
  if (!manifest.entryPoint) errors.push('Entry point is required');
  if (!['command', 'http', 'inline'].includes(manifest.type)) {
    errors.push(`Invalid plugin type: ${manifest.type}`);
  }
  return errors;
}
