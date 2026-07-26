/**
 * MCP serve — MCP server hosting.
 */

export interface MCPServerConfig {
  name: string;
  version: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

/**
 * Build an MCP server configuration.
 */
export function buildMCPServerConfig(name: string, version: string, tools: MCPServerConfig['tools'] = []): MCPServerConfig {
  return { name, version, tools };
}

/**
 * Register a tool with an MCP server config.
 */
export function registerMCPTool(config: MCPServerConfig, tool: MCPServerConfig['tools'][0]): void {
  config.tools.push(tool);
}

/**
 * Format MCP server config for display.
 */
export function formatMCPServerConfig(config: MCPServerConfig): string {
  const tools = config.tools.map(t => `  • ${t.name}: ${t.description}`).join('\n');
  return `${config.name} v${config.version}\nTools (${config.tools.length}):\n${tools}`;
}
