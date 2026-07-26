/**
 * Workspace RPC handler — dispatches workspace.* JSON-RPC methods.
 *
 */

import { WorkspaceHandle } from './workspace_ops';
import {
  WORKSPACE_RPC_TOOL_ID,
  WORKSPACE_EVENTS_TOOL_ID,
} from './hub_ids';

export interface RpcRequest {
  method: string;
  params: any;
  sessionId?: string;
}

export interface RpcResponse {
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface RpcMetrics {
  requestsTotal: Map<string, number>;
  mutationTotal: Map<string, number>;
  durationSeconds: Map<string, number[]>;
}

const UNKNOWN_METHOD_PREFIX = 'unknown workspace method:';

/**
 * WorkspaceRpcHandler — dispatches workspace.* JSON-RPC methods to WorkspaceHandle.
 */
export class WorkspaceRpcHandler {
  private handle: WorkspaceHandle;
  private metrics: RpcMetrics = {
    requestsTotal: new Map(),
    mutationTotal: new Map(),
    durationSeconds: new Map(),
  };

  constructor(handle: WorkspaceHandle) {
    this.handle = handle;
  }

  /**
   * Dispatch a workspace.* RPC request.
   */
  async dispatch(request: RpcRequest): Promise<RpcResponse> {
    const startTime = Date.now();
    const method = request.method;

    try {
      const result = await this.doDispatch(request);

      // Record metrics
      this.recordMetric(method, 'ok');
      this.recordDuration(method, Date.now() - startTime);

      return { result };
    } catch (err: any) {
      this.recordMetric(method, 'error');
      this.recordDuration(method, Date.now() - startTime);

      return {
        error: {
          code: -32000,
          message: err.message || 'Unknown error',
        },
      };
    }
  }

  private async doDispatch(request: RpcRequest): Promise<any> {
    const { method, params, sessionId } = request;

    switch (method) {
      case 'workspace.update_tool_config':
        return this.handle.updateToolConfig(
          params.session_id || sessionId || '',
          params.config
        );

      case 'workspace.drop_session':
        return this.handle.dropSession(
          params.session_id || sessionId || ''
        );

      case 'workspace.configure_mcp':
        return this.handle.configureMcp(
          params.session_id || sessionId || '',
          params.config
        );

      case 'workspace.get_file':
        return { content: await this.handle.readFile(params.path) };

      case 'workspace.put_file':
        await this.handle.writeFile(params.path, params.content);
        return { success: true };

      case 'workspace.list_dir':
        return { entries: await this.handle.listDir(params.path) };

      case 'workspace.git_status':
        return this.handle.gitStatus();

      case 'workspace.git_diff':
        return { diff: await this.handle.gitDiff(params) };

      case 'workspace.git_commit':
        await this.handle.gitCommit(params.message);
        return { success: true };

      case 'workspace.code_find_definitions':
        return {
          locations: await this.handle.codeFindDefinitions(
            params.file,
            params.line
          ),
        };

      case 'workspace.code_find_references':
        return {
          locations: await this.handle.codeFindReferences(
            params.file,
            params.line
          ),
        };

      case 'workspace.get_filtered_hunks':
        return this.handle.getFilteredHunks(
          params.session_id || sessionId || ''
        );

      case 'workspace.hunk_action':
        return this.handle.hunkAction(params);

      case 'workspace.info':
        return this.handle.getWorkspaceInfo();

      case 'workspace.get_tasks_snapshot':
        return { tasks: [], background: [] };

      case 'workspace.get_scheduled_tasks':
        return { tasks: [] };

      default:
        throw new Error(`${UNKNOWN_METHOD_PREFIX} ${method}`);
    }
  }

  private recordMetric(method: string, outcome: string): void {
    const key = `${method}:${outcome}`;
    this.metrics.requestsTotal.set(
      key,
      (this.metrics.requestsTotal.get(key) || 0) + 1
    );
  }

  private recordDuration(method: string, ms: number): void {
    const durations = this.metrics.durationSeconds.get(method) || [];
    durations.push(ms);
    this.metrics.durationSeconds.set(method, durations);
  }

  getMetrics(): RpcMetrics {
    return this.metrics;
  }
}

/**
 * Resolve caller identity for mutation RPCs.
 */
export function resolveMutationCaller(
  method: string,
  boundSession?: string,
  paramCaller?: string
): string {
  if (boundSession && paramCaller) {
    if (boundSession !== paramCaller) {
      // Mismatch — log warning but trust envelope
      console.warn(
        `[WorkspaceRpcHandler] caller_session_id param disagrees with envelope session for ${method}; trusting envelope`
      );
    }
    return boundSession;
  }

  if (boundSession) return boundSession;
  if (paramCaller) return paramCaller;

  throw new Error(
    `${method}: missing caller identity (no bound session and no caller_session_id)`
  );
}
