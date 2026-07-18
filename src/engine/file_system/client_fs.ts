/**
 * Client filesystem — RPC-based filesystem for client-side operations.
 *
 */

export interface ClientFsNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
}

export interface ClientFsListRequest {
  path: string;
  maxDepth?: number;
}

export interface ClientFsListResponse {
  entries: ClientFsNode[];
}

export interface ClientFsReadFileRequest {
  path: string;
  encoding?: string;
}

export interface ClientFsReadFileResponse {
  content: string;
  encoding: string;
}

export interface ClientFsStatRequest {
  path: string;
}

export interface ClientFsStatResponse {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  modifiedAt?: string;
}

/**
 * ClientFs — filesystem operations via workspace RPC.
 */
export class ClientFs {
  private rpcCall: (method: string, params: any) => Promise<any>;

  constructor(rpcCall: (method: string, params: any) => Promise<any>) {
    this.rpcCall = rpcCall;
  }

  async list(req: ClientFsListRequest): Promise<ClientFsListResponse> {
    const result = await this.rpcCall('workspace.client_fs_list', req);
    return { entries: result.entries || [] };
  }

  async readFile(req: ClientFsReadFileRequest): Promise<ClientFsReadFileResponse> {
    const result = await this.rpcCall('workspace.client_fs_read_file', req);
    return {
      content: result.content || '',
      encoding: result.encoding || 'utf-8',
    };
  }

  async stat(req: ClientFsStatRequest): Promise<ClientFsStatResponse> {
    const result = await this.rpcCall('workspace.client_fs_stat', req);
    return {
      exists: result.exists ?? false,
      isFile: result.is_file ?? false,
      isDirectory: result.is_directory ?? false,
      size: result.size ?? 0,
      modifiedAt: result.modified_at,
    };
  }
}
