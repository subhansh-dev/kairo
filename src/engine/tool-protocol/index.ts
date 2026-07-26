/**
 * Tool protocol — wire protocol types for tool communication.
 */

export type MethodName = string;

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: MethodName;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: MethodName;
  params?: Record<string, unknown>;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// Error codes
export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000,
} as const;

// Method names
export const METHODS = {
  INITIALIZE: 'initialize',
  INITIALIZED: 'initialized',
  SHUTDOWN: 'shutdown',
  EXIT: 'exit',
  PING: 'ping',
  LIST_TOOLS: 'tools/list',
  CALL_TOOL: 'tools/call',
  LIST_RESOURCES: 'resources/list',
  READ_RESOURCE: 'resources/read',
  SUBSCRIBE: 'notifications/subscribe',
  UNSUBSCRIBE: 'notifications/unsubscribe',
} as const;

/**
 * Create a JSON-RPC request.
 */
export function createRequest(
  id: string | number,
  method: MethodName,
  params?: Record<string, unknown>,
): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method, params };
}

/**
 * Create a JSON-RPC response.
 */
export function createResponse(
  id: string | number,
  result?: unknown,
  error?: JSONRPCError,
): JSONRPCResponse {
  return { jsonrpc: '2.0', id, result, error };
}

/**
 * Create a JSON-RPC notification.
 */
export function createNotification(
  method: MethodName,
  params?: Record<string, unknown>,
): JSONRPCNotification {
  return { jsonrpc: '2.0', method, params };
}

/**
 * Check if a message is a request.
 */
export function isRequest(msg: JSONRPCMessage): msg is JSONRPCRequest {
  return 'method' in msg && 'id' in msg && !('error' in msg);
}

/**
 * Check if a message is a response.
 */
export function isResponse(msg: JSONRPCMessage): msg is JSONRPCResponse {
  return 'result' in msg || 'error' in msg;
}

/**
 * Check if a message is a notification.
 */
export function isNotification(msg: JSONRPCMessage): msg is JSONRPCNotification {
  return 'method' in msg && !('id' in msg);
}
