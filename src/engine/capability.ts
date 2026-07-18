/**
 * Tool capability mode filtering.
 *
 * Controls which tools are available to each agent/toolset,
 * with deny-wins and capability-level overrides.
 */

import type { ToolIdentity } from './taxonomy';

// Tool capability modes
export type CapabilityMode =
  | 'hidden'     // Tool not listed
  | 'read-only'  // Read-only access
  | 'full'       // Full access
  | 'exec'       // Execution access (bash, etc.)
  | 'dangerous'; // Dangerous access (network, file delete, etc.)

export interface CapabilityRule {
  namespace?: string;
  tool?: string;
  mode: CapabilityMode;
}

export interface CapabilityConfig {
  /** Base mode for all tools */
  baseMode: CapabilityMode;
  /** Per-namespace/tool overrides */
  overrides: CapabilityRule[];
  /** Maximum number of concurrent tool calls */
  maxConcurrent?: number;
  /** Timeout for tool calls in ms */
  timeoutMs?: number;
}

/**
 * Get the effective capability mode for a tool.
 */
export function getCapabilityMode(
  identity: ToolIdentity,
  config: CapabilityConfig
): CapabilityMode {
  // Check overrides (last match wins)
  let mode = config.baseMode;

  for (const rule of config.overrides) {
    const matchesNamespace = !rule.namespace || rule.namespace === identity.namespace;
    const matchesTool = !rule.tool || rule.tool === identity.toolKind;

    if (matchesNamespace && matchesTool) {
      mode = rule.mode;
    }
  }

  return mode;
}

/**
 * Check if a tool is allowed in a given capability mode.
 */
export function isToolAllowed(
  identity: ToolIdentity,
  requiredMode: CapabilityMode,
  config: CapabilityConfig
): boolean {
  const mode = getCapabilityMode(identity, config);
  const hierarchy: CapabilityMode[] = ['hidden', 'read-only', 'full', 'exec', 'dangerous'];
  return hierarchy.indexOf(mode) >= hierarchy.indexOf(requiredMode);
}

/**
 * Create a capability config with sensible defaults.
 */
export function createCapabilityConfig(
  overrides: CapabilityRule[] = [],
  baseMode: CapabilityMode = 'full'
): CapabilityConfig {
  return {
    baseMode,
    overrides,
  };
}

/**
 * Filter a list of tool identities by capability mode.
 */
export function filterToolsByCapability(
  tools: ToolIdentity[],
  config: CapabilityConfig
): ToolIdentity[] {
  return tools.filter(tool => {
    const mode = getCapabilityMode(tool, config);
    return mode !== 'hidden';
  });
}

/**
 * Get the allowed tools for a specific capability level.
 */
export function getAllowedTools(
  tools: ToolIdentity[],
  requiredMode: CapabilityMode,
  config: CapabilityConfig
): ToolIdentity[] {
  return tools.filter(tool => isToolAllowed(tool, requiredMode, config));
}
