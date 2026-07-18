/**
 * MCP config — MCP server configuration management.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

const MCP_CONFIG_FILE = join(homedir(), '.kairo', 'mcp-servers.json');

/**
 * Load MCP server configurations.
 */
export function loadMCPConfig(): Record<string, MCPServerConfig> {
  try {
    if (existsSync(MCP_CONFIG_FILE)) {
      const data = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf-8'));
      const servers: Record<string, MCPServerConfig> = {};
      for (const [name, config] of Object.entries(data.mcpServers || data)) {
        servers[name] = { name, ...(config as any), enabled: (config as any).enabled ?? true };
      }
      return servers;
    }
  } catch { /* ok */ }
  return {};
}

/**
 * Save MCP server configurations.
 */
export function saveMCPConfig(servers: Record<string, MCPServerConfig>): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = { mcpServers: {} as Record<string, any> };
    for (const [name, config] of Object.entries(servers)) {
      const { name: _, ...rest } = config;
      data.mcpServers[name] = rest;
    }
    writeFileSync(MCP_CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Add an MCP server configuration.
 */
export function addMCPServer(name: string, command: string, args?: string[], env?: Record<string, string>): void {
  const servers = loadMCPConfig();
  servers[name] = { name, command, args, env, enabled: true };
  saveMCPConfig(servers);
}

/**
 * Remove an MCP server configuration.
 */
export function removeMCPServer(name: string): boolean {
  const servers = loadMCPConfig();
  if (!(name in servers)) return false;
  delete servers[name];
  saveMCPConfig(servers);
  return true;
}

/**
 * Enable/disable an MCP server.
 */
export function toggleMCPServer(name: string, enabled: boolean): boolean {
  const servers = loadMCPConfig();
  if (!(name in servers)) return false;
  servers[name].enabled = enabled;
  saveMCPConfig(servers);
  return true;
}

/**
 * Format MCP config for display.
 */
export function formatMCPConfig(): string {
  const servers = loadMCPConfig();
  if (Object.keys(servers).length === 0) return 'No MCP servers configured.';

  return Object.values(servers).map(s => {
    const icon = s.enabled ? '✅' : '⏸️';
    return `${icon} ${s.name}: ${s.command} ${(s.args || []).join(' ')}`;
  }).join('\n');
}
