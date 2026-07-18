/**
 * Kairo — MCP Client (Functional)
 * JSON-RPC over stdio for Model Context Protocol
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'stdio' | 'http' | 'sse';
  enabled?: boolean;
  timeout?: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── MCP Server Connection ──────────────────────────────────────

class MCPServerConnection extends EventEmitter {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private _tools: MCPTool[] = [];
  private serverName: string;

  constructor(private config: MCPServerConfig) {
    super();
    this.serverName = config.name;
  }

  get tools(): MCPTool[] { return this._tools; }
  get connected(): boolean { return this.proc !== null; }

  async connect(): Promise<boolean> {
    if (!this.config.command) return false;

    try {
      this.proc = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      this.proc.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        // MCP servers may log to stderr
      });

      this.proc.on('exit', () => {
        this.proc = null;
        this.emit('exit');
      });

      this.proc.on('error', () => {
        this.proc = null;
      });

      // Initialize handshake
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'kairo', version: '0.3.0' },
      });

      if (!initResult) return false;

      // Send initialized notification
      this.sendNotification('notifications/initialized', {});

      // Discover tools
      await this.discoverTools();

      return true;
    } catch {
      this.proc = null;
      return false;
    }
  }

  private processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as JSONRPCResponse;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin) {
        reject(new Error('Not connected'));
        return;
      }

      const id = this.nextId++;
      const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };

      const timeout = this.config.timeout || 30000;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, timeout);

      const wrappedResolve = (v: unknown) => { clearTimeout(timer); resolve(v); };
      const wrappedReject = (e: Error) => { clearTimeout(timer); reject(e); };
      this.pending.set(id, { resolve: wrappedResolve, reject: wrappedReject });

      this.proc.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>) {
    if (!this.proc?.stdin) return;
    const notification = { jsonrpc: '2.0', method, params };
    this.proc.stdin.write(JSON.stringify(notification) + '\n');
  }

  private async discoverTools() {
    try {
      const result = await this.sendRequest('tools/list', {}) as any;
      if (result?.tools) {
        this._tools = result.tools.map((t: any) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || {},
          serverName: this.serverName,
        }));
      }
    } catch {}
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  disconnect() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    for (const [, { reject }] of this.pending) {
      reject(new Error('Disconnected'));
    }
    this.pending.clear();
  }
}

// ─── MCP Client ─────────────────────────────────────────────────

export class MCPClient {
  private servers: Map<string, MCPServerConnection> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();

  constructor(projectDir?: string) {
    this.loadConfig(projectDir);
  }

  private loadConfig(projectDir?: string) {
    const paths = [
      join(homedir(), '.kairo', 'mcp-servers.json'),
      join(homedir(), '.claude.json'),
    ];

    if (projectDir) {
      paths.push(join(projectDir, '.kairo', 'mcp-servers.json'));
      paths.push(join(projectDir, '.claude', 'mcp-servers.json'));
    }

    for (const p of paths) {
      if (!existsSync(p)) continue;
      try {
        const config = JSON.parse(readFileSync(p, 'utf-8'));
        for (const [name, server] of Object.entries(config.mcpServers || {})) {
          if (!this.configs.has(name)) {
            this.configs.set(name, { name, ...(server as any) });
          }
        }
      } catch {}
    }
  }

  async connectAll(): Promise<void> {
    const overallTimeout = 5_000;
    for (const [name, config] of this.configs) {
      if (config.enabled === false) continue;
      if (config.transport && config.transport !== 'stdio') continue;

      const conn = new MCPServerConnection(config);
      try {
        const connected = await Promise.race<boolean>([
          conn.connect(),
          new Promise<boolean>(resolve => setTimeout(() => { conn.disconnect(); resolve(false); }, overallTimeout)),
        ]);
        if (connected) {
          this.servers.set(name, conn);
        } else if (this.servers.has(name) === false) {
          conn.disconnect();
        }
      } catch {
        conn.disconnect();
      }
    }
  }

  async connectServer(name: string): Promise<boolean> {
    const config = this.configs.get(name);
    if (!config) return false;

    const conn = new MCPServerConnection(config);
    const connected = await conn.connect();
    if (connected) {
      this.servers.set(name, conn);
    }
    return connected;
  }

  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const conn of this.servers.values()) {
      tools.push(...conn.tools);
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    for (const conn of this.servers.values()) {
      const tool = conn.tools.find(t => t.name === name);
      if (tool) {
        return conn.callTool(name, args);
      }
    }
    throw new Error(`MCP tool not found: ${name}`);
  }

  getServers(): MCPServerConfig[] {
    return Array.from(this.configs.values());
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }

  disconnectAll() {
    for (const conn of this.servers.values()) {
      conn.disconnect();
    }
    this.servers.clear();
  }

  // ─── Environment Variable Expansion ──────────

  /**
   * Expand ${ENV_VAR} references in MCP server config
   */
  expandEnvVars(config: MCPServerConfig): MCPServerConfig {
    const expanded = { ...config };

    if (expanded.command) {
      expanded.command = expanded.command.replace(/\$\{(\w+)\}/g, (_, varName) =>
        process.env[varName] || ''
      );
    }

    if (expanded.args) {
      expanded.args = expanded.args.map(arg =>
        arg.replace(/\$\{(\w+)\}/g, (_, varName) => process.env[varName] || '')
      );
    }

    if (expanded.env) {
      const expandedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(expanded.env)) {
        expandedEnv[key] = value.replace(/\$\{(\w+)\}/g, (_, varName) =>
          process.env[varName] || ''
        );
      }
      expanded.env = expandedEnv;
    }

    return expanded;
  }

  // ─── MCP Doctor ──────────────────────────────

  /**
   * Diagnose MCP server connectivity issues
   */
  async diagnose(): Promise<string[]> {
    const issues: string[] = [];

    for (const [name, config] of this.configs) {
      if (config.enabled === false) {
        issues.push(`[${name}] Disabled in config`);
        continue;
      }

      if (!config.command && !config.url) {
        issues.push(`[${name}] No command or URL configured`);
        continue;
      }

      if (config.command) {
        const conn = this.servers.get(name);
        if (!conn) {
          issues.push(`[${name}] Not connected`);
        } else if (!conn.connected) {
          issues.push(`[${name}] Connection lost`);
        } else if (conn.tools.length === 0) {
          issues.push(`[${name}] Connected but no tools discovered`);
        }
      }
    }

    if (issues.length === 0) {
      issues.push('All MCP servers healthy');
    }

    return issues;
  }

  // ─── Tool Normalization ──────────────────────

  /**
   * Normalize MCP tool names for consistent referencing
   */
  normalizeToolName(serverName: string, toolName: string): string {
    return `mcp_${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Get server health status
   */
  getServerHealth(): Record<string, { connected: boolean; toolCount: number; uptime?: number }> {
    const health: Record<string, { connected: boolean; toolCount: number; uptime?: number }> = {};

    for (const [name, config] of this.configs) {
      const conn = this.servers.get(name);
      health[name] = {
        connected: conn?.connected ?? false,
        toolCount: conn?.tools.length ?? 0,
      };
    }

    return health;
  }
}
