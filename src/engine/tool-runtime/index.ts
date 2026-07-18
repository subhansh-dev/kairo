/**
 * Tool runtime — execution context, dispatch, and error handling.
 */

import type { ToolCall, ToolResult, ToolDefinition } from '../tool-types.js';

export interface ToolContext {
  workspaceRoot: string;
  sessionId: string;
  agentType: string;
  permissions: Set<string>;
  env: Record<string, string>;
}

export interface ToolDispatcher {
  register(tool: ToolDefinition, handler: ToolHandler): void;
  dispatch(call: ToolCall, context: ToolContext): Promise<ToolResult>;
  listTools(): ToolDefinition[];
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<string>;

export interface ToolError {
  type: 'permission' | 'timeout' | 'not_found' | 'execution' | 'validation';
  message: string;
  toolName: string;
  retryable: boolean;
}

/**
 * Create a tool dispatcher.
 */
export function createDispatcher(): ToolDispatcher {
  const handlers = new Map<string, { tool: ToolDefinition; handler: ToolHandler }>();

  return {
    register(tool, handler) {
      handlers.set(tool.name, { tool, handler });
    },

    async dispatch(call, context) {
      const entry = handlers.get(call.name);
      if (!entry) {
        return {
          callId: call.id,
          success: false,
          error: `Tool not found: ${call.name}`,
          durationMs: 0,
        };
      }

      // Check permissions
      if (entry.tool.permissions) {
        for (const perm of entry.tool.permissions) {
          if (!context.permissions.has(perm)) {
            return {
              callId: call.id,
              success: false,
              error: `Missing permission: ${perm}`,
              durationMs: 0,
            };
          }
        }
      }

      const start = Date.now();
      try {
        const timeout = entry.tool.timeout ?? 30_000;
        const output = await Promise.race([
          entry.handler(call.arguments, context),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Tool timeout')), timeout)
          ),
        ]);

        return {
          callId: call.id,
          success: true,
          output,
          durationMs: Date.now() - start,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          callId: call.id,
          success: false,
          error: errMsg,
          durationMs: Date.now() - start,
        };
      }
    },

    listTools() {
      return [...handlers.values()].map(e => e.tool);
    },
  };
}

/**
 * Create a tool error.
 */
export function createToolError(
  type: ToolError['type'],
  message: string,
  toolName: string,
  retryable: boolean = false,
): ToolError {
  return { type, message, toolName, retryable };
}

/**
 * Search tools by name or category.
 */
export function searchTools(
  tools: ToolDefinition[],
  query: string,
): ToolDefinition[] {
  const q = query.toLowerCase();
  return tools.filter(
    t => t.name.toLowerCase().includes(q) ||
         t.description.toLowerCase().includes(q) ||
         t.category.toLowerCase().includes(q),
  );
}
