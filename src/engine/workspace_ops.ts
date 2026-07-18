/**
 * WorkspaceOps — dual-mode workspace operations handle.
 *
 * Two modes:
 * - Local — extensions dispatch through WorkspaceHandle; tool calls
 *   dispatch through the workspace session's toolset.
 * - Proxy — everything routes through hub WebSocket to a remote workspace.
 *
 */

import { EventEmitter } from 'events';

export interface WorkspaceRpc {
  readonly METHOD: string;
  Response: any;
}

export interface WorkspaceOp<T extends WorkspaceRpc> extends WorkspaceRpc {
  execute(ws: WorkspaceHandle, sessionId?: string): Promise<T['Response']>;
}

export interface WorkspaceHandle extends EventEmitter {
  readonly id: string;
  readonly cwd: string;

  // Tool config
  updateToolConfig(sessionId: string, config: any): Promise<void>;

  // Session management
  dropSession(sessionId: string): Promise<void>;

  // MCP configuration
  configureMcp(sessionId: string, config: any): Promise<void>;

  // File operations
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;

  // Git operations
  gitStatus(): Promise<GitStatus>;
  gitDiff(options?: GitDiffOptions): Promise<string>;
  gitCommit(message: string): Promise<void>;

  // Code navigation
  codeFindDefinitions(file: string, line: number): Promise<CodeNavLocation[]>;
  codeFindReferences(file: string, line: number): Promise<CodeNavLocation[]>;

  // Hunk operations
  getFilteredHunks(sessionId: string): Promise<any>;
  hunkAction(action: HunkActionRequest): Promise<any>;

  // Workspace info
  getWorkspaceInfo(): Promise<WorkspaceInfo>;
}

export interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
}

export interface GitStatus {
  branch: string;
  dirty: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface GitDiffOptions {
  staged?: boolean;
  file?: string;
}

export interface CodeNavLocation {
  file: string;
  line: number;
  column: number;
  text?: string;
}

export interface HunkActionRequest {
  action: 'accept' | 'reject' | 'edit';
  hunkId: string;
  filePath: string;
  content?: string;
}

export interface WorkspaceInfo {
  id: string;
  cwd: string;
  sessionId: string;
  toolCount: number;
  mcpServers: string[];
}

/**
 * LocalWorkspaceHandle — direct local filesystem operations.
 */
export class LocalWorkspaceHandle extends EventEmitter implements WorkspaceHandle {
  readonly id: string;
  readonly cwd: string;

  constructor(id: string, cwd: string) {
    super();
    this.id = id;
    this.cwd = cwd;
  }

  async updateToolConfig(_sessionId: string, _config: any): Promise<void> {
    // TODO: Implement tool config update
  }

  async dropSession(_sessionId: string): Promise<void> {
    // TODO: Implement session drop
  }

  async configureMcp(_sessionId: string, _config: any): Promise<void> {
    // TODO: Implement MCP configuration
  }

  async readFile(path: string): Promise<string> {
    const fs = await import('fs/promises');
    return fs.readFile(path, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fs = await import('fs/promises');
    const dir = require('path').dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async listDir(dirPath: string): Promise<DirEntry[]> {
    const fs = await import('fs/promises');
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' as const : e.isFile() ? 'file' as const : 'symlink' as const,
    }));
  }

  async gitStatus(): Promise<GitStatus> {
    // TODO: Implement git status
    return { branch: 'main', dirty: false, staged: [], modified: [], untracked: [] };
  }

  async gitDiff(_options?: GitDiffOptions): Promise<string> {
    return '';
  }

  async gitCommit(_message: string): Promise<void> {
    // TODO: Implement git commit
  }

  async codeFindDefinitions(_file: string, _line: number): Promise<CodeNavLocation[]> {
    return [];
  }

  async codeFindReferences(_file: string, _line: number): Promise<CodeNavLocation[]> {
    return [];
  }

  async getFilteredHunks(_sessionId: string): Promise<any> {
    return { hunks: [] };
  }

  async hunkAction(_action: HunkActionRequest): Promise<any> {
    return { success: true };
  }

  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    return {
      id: this.id,
      cwd: this.cwd,
      sessionId: '',
      toolCount: 0,
      mcpServers: [],
    };
  }
}

/**
 * ProxyWorkspaceHandle — routes operations through hub WebSocket.
 */
export class ProxyWorkspaceHandle extends EventEmitter implements WorkspaceHandle {
  readonly id: string;
  readonly cwd: string;
  private rpcCall: (method: string, params: any) => Promise<any>;

  constructor(id: string, cwd: string, rpcCall: (method: string, params: any) => Promise<any>) {
    super();
    this.id = id;
    this.cwd = cwd;
    this.rpcCall = rpcCall;
  }

  async updateToolConfig(sessionId: string, config: any): Promise<void> {
    await this.rpcCall('workspace.update_tool_config', { session_id: sessionId, config });
  }

  async dropSession(sessionId: string): Promise<void> {
    await this.rpcCall('workspace.drop_session', { session_id: sessionId });
  }

  async configureMcp(sessionId: string, config: any): Promise<void> {
    await this.rpcCall('workspace.configure_mcp', { session_id: sessionId, config });
  }

  async readFile(filePath: string): Promise<string> {
    const result = await this.rpcCall('workspace.get_file', { path: filePath });
    return result.content || '';
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.rpcCall('workspace.put_file', { path: filePath, content });
  }

  async listDir(dirPath: string): Promise<DirEntry[]> {
    const result = await this.rpcCall('workspace.list_dir', { path: dirPath });
    return result.entries || [];
  }

  async gitStatus(): Promise<GitStatus> {
    return this.rpcCall('workspace.git_status', {});
  }

  async gitDiff(options?: GitDiffOptions): Promise<string> {
    const result = await this.rpcCall('workspace.git_diff', options || {});
    return result.diff || '';
  }

  async gitCommit(message: string): Promise<void> {
    await this.rpcCall('workspace.git_commit', { message });
  }

  async codeFindDefinitions(file: string, line: number): Promise<CodeNavLocation[]> {
    const result = await this.rpcCall('workspace.code_find_definitions', { file, line });
    return result.locations || [];
  }

  async codeFindReferences(file: string, line: number): Promise<CodeNavLocation[]> {
    const result = await this.rpcCall('workspace.code_find_references', { file, line });
    return result.locations || [];
  }

  async getFilteredHunks(sessionId: string): Promise<any> {
    return this.rpcCall('workspace.get_filtered_hunks', { session_id: sessionId });
  }

  async hunkAction(action: HunkActionRequest): Promise<any> {
    return this.rpcCall('workspace.hunk_action', action);
  }

  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    return this.rpcCall('workspace.info', {});
  }
}
