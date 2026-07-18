/**
 * MCP tool bridge — bridge between MCP tools and the tool registry.
 */

export interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

// Registered MCP tools
const mcpTools = new Map<string, MCPToolDef>();

/**
 * Register an MCP tool.
 */
export function registerMCPTool(tool: MCPToolDef): void {
  const fullName = `mcp_${tool.serverName}_${tool.name}`;
  mcpTools.set(fullName, { ...tool, name: fullName });
}

/**
 * Get all registered MCP tools.
 */
export function getMCPTools(): MCPToolDef[] {
  return [...mcpTools.values()];
}

/**
 * Check if a tool name is an MCP tool.
 */
export function isMCPTool(toolName: string): boolean {
  return toolName.startsWith('mcp_');
}

/**
 * Get the server name from an MCP tool name.
 */
export function getMCPServerName(toolName: string): string | null {
  if (!isMCPTool(toolName)) return null;
  const parts = toolName.split('_');
  return parts.length >= 3 ? parts[1] : null;
}

/**
 * Check if an MCP tool is parallel-safe.
 */
export function isMCPToolParallelSafe(toolName: string): boolean {
  // MCP tools are parallel-safe by default (read-only assumption)
  // Override this for specific tools that modify state
  return true;
}

/**
 * Clear all registered MCP tools.
 */
export function clearMCPTools(): void {
  mcpTools.clear();
}
