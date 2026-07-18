/**
 * Tool config resolution pipeline.
 *
 * Five-step resolution:
 * 1. effective_tool_config from parent or config
 * 2. Merge MCP tools
 * 3. Merge hub tools
 * 4. Filter by capability mode
 * 5. Build finalized toolset
 */

import type { CapabilityMode, CapabilityConfig } from './capability';
import { getCapabilityMode, isToolAllowed } from './capability';

export interface ToolConfig {
  id: string;
  name: string;
  kind?: string;
  namespace?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ToolServerConfig {
  tools: ToolConfig[];
  pinned?: string[];
}

export interface FinalizedToolset {
  config: ToolServerConfig;
  toolIds: string[];
  toolCount: number;
}

/**
 * Backfill tool kinds from a known registry.
 */
export function backfillToolKinds(
  config: ToolServerConfig,
  knownKinds: Map<string, string>
): ToolServerConfig {
  return {
    ...config,
    tools: config.tools.map(tool => {
      if (!tool.kind && knownKinds.has(tool.id)) {
        return { ...tool, kind: knownKinds.get(tool.id) };
      }
      return tool;
    }),
  };
}

/**
 * Merge MCP tools into the effective config.
 */
export function mergeMcpTools(
  effective: ToolServerConfig,
  mcpSnapshot: ToolConfig[]
): ToolServerConfig {
  const existingIds = new Set(effective.tools.map(t => t.id));
  const newTools = mcpSnapshot.filter(t => !existingIds.has(t.id));

  return {
    ...effective,
    tools: [...effective.tools, ...newTools],
  };
}

/**
 * Merge hub tools into the effective config.
 */
export function mergeHubTools(
  effective: ToolServerConfig,
  hubSnapshot: ToolConfig[]
): ToolServerConfig {
  const existingIds = new Set(effective.tools.map(t => t.id));
  const newTools = hubSnapshot.filter(t => !existingIds.has(t.id));

  return {
    ...effective,
    tools: [...effective.tools, ...newTools],
  };
}

/**
 * Filter tools by capability mode.
 */
export function filterByCapability(
  config: ToolServerConfig,
  mode: CapabilityMode
): ToolServerConfig {
  return {
    ...config,
    tools: config.tools.filter(tool => {
      const toolMode: CapabilityMode = mode;
      return toolMode !== 'hidden';
    }),
  };
}

/**
 * Build a finalized toolset from the resolved config.
 */
export function buildFinalizedToolset(
  config: ToolServerConfig
): FinalizedToolset {
  return {
    config,
    toolIds: config.tools.map(t => t.id),
    toolCount: config.tools.length,
  };
}

/**
 * Full resolution pipeline.
 */
export function resolveSessionToolset(
  effectiveConfig: ToolServerConfig,
  capabilityMode: CapabilityMode,
  mcpSnapshot: ToolConfig[],
  hubSnapshot: ToolConfig[]
): FinalizedToolset {
  const afterMcp = mergeMcpTools(effectiveConfig, mcpSnapshot);
  const afterHub = mergeHubTools(afterMcp, hubSnapshot);
  const filtered = filterByCapability(afterHub, capabilityMode);
  return buildFinalizedToolset(filtered);
}
