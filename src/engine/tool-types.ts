/**
 * Tool type definitions — types, task types, and extension points.
 */

export type ToolCategory = 'file' | 'shell' | 'web' | 'search' | 'memory' | 'agent' | 'other';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissions?: ToolPermission[];
  timeout?: number;
  retryable?: boolean;
}

export type ToolPermission = 'read' | 'write' | 'execute' | 'network' | 'admin';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  timestamp: Date;
}

export interface ToolResult {
  callId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export type TaskType = 'auto' | 'code' | 'research' | 'data' | 'system' | 'other';

export interface TaskDefinition {
  type: TaskType;
  description: string;
  requiredTools: string[];
  preferredTools: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
}

/**
 * Create a tool call from raw data.
 */
export function createToolCall(
  name: string,
  args: Record<string, unknown>,
): ToolCall {
  return {
    id: crypto.randomUUID(),
    name,
    arguments: args,
    timestamp: new Date(),
  };
}

/**
 * Create a tool result.
 */
export function createToolResult(
  callId: string,
  success: boolean,
  output?: string,
  error?: string,
  durationMs: number = 0,
): ToolResult {
  return { callId, success, output, error, durationMs };
}
