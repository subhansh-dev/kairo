/**
 * Workspace types — identity, metadata, and request types.
 */

export interface WorkspaceIdentity {
  id: string;
  name: string;
  rootPath: string;
  createdAt: Date;
}

export interface WorkspaceMetadata {
  description?: string;
  language?: string;
  framework?: string;
  tags: string[];
  lastModified: Date;
}

export interface WorkspaceConfig {
  identity: WorkspaceIdentity;
  metadata: WorkspaceMetadata;
  permissions: WorkspacePermission[];
}

export type WorkspacePermission = 'read' | 'write' | 'execute' | 'admin';

export interface WorkspaceRequest {
  id: string;
  type: 'file_read' | 'file_write' | 'shell_exec' | 'tool_call';
  path?: string;
  content?: string;
  command?: string;
  timestamp: Date;
}

export interface WorkspaceChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  tokens: number;
}

export interface WorkspaceEvent {
  type: 'file_changed' | 'file_created' | 'file_deleted' | 'config_updated';
  path: string;
  timestamp: Date;
}

/**
 * Create a workspace identity.
 */
export function createWorkspaceIdentity(
  name: string,
  rootPath: string,
): WorkspaceIdentity {
  return {
    id: crypto.randomUUID(),
    name,
    rootPath,
    createdAt: new Date(),
  };
}

/**
 * Create workspace metadata.
 */
export function createWorkspaceMetadata(
  description?: string,
  language?: string,
): WorkspaceMetadata {
  return {
    description,
    language,
    tags: [],
    lastModified: new Date(),
  };
}
