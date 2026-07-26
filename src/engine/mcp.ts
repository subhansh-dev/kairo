/**
 * MCP (Model Context Protocol) integration.
 *
 * Bridges MCP clients to the workspace server and wraps
 * tool handlers with qualified names.
 */

import type { ToolIdentity } from './taxonomy';

export interface McpServerInfo {
  name: string;
  version: string;
  capabilities?: Record<string, unknown>;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  content: McpContent[];
  isError?: boolean;
}

export interface McpContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri: string;
    mimeType?: string;
    text?: string;
  };
}

export interface McpTransport {
  initialize(): Promise<McpServerInfo>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  shutdown?(): Promise<void>;
}

export interface McpBridgeConfig {
  /** Server name prefix for tool names */
  serverPrefix: string;
  /** Whether to include server name in tool definitions */
  qualifyNames: boolean;
}

/**
 * Wrap an MCP tool name with server prefix.
 */
export function qualifyToolName(
  serverName: string,
  toolName: string,
  config: McpBridgeConfig
): string {
  if (!config.qualifyNames) return toolName;
  return `${config.serverPrefix}__${toolName}`;
}

/**
 * Unwrap a qualified MCP tool name.
 */
export function unqualifyToolName(
  qualifiedName: string,
  config: McpBridgeConfig
): string {
  if (!config.qualifyNames) return qualifiedName;
  const prefix = `${config.serverPrefix}__`;
  if (qualifiedName.startsWith(prefix)) {
    return qualifiedName.slice(prefix.length);
  }
  return qualifiedName;
}

/**
 * Convert MCP tool definition to ToolIdentity.
 */
export function mcpToolToIdentity(
  mcpTool: McpToolDefinition,
  serverName: string
): ToolIdentity {
  return {
    namespace: 'mcp',
    toolKind: mcpTool.name as any,
    presentationName: `${serverName}__${mcpTool.name}`,
    readOnly: false,
  };
}

/**
 * Create a default MCP bridge config.
 */
export function createMcpBridgeConfig(
  serverName: string,
  qualifyNames: boolean = true
): McpBridgeConfig {
  return {
    serverPrefix: serverName,
    qualifyNames,
  };
}
