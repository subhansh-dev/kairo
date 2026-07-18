/**
 * RPC envelope types for workspace communication.
 *
 * Maps workspace errors to wire codes and back.
 */

export type RpcErrorCode =
  | 'parent_session_not_found'
  | 'session_not_found'
  | 'session_already_exists'
  | 'empty_agent_id'
  | 'cannot_drop_main'
  | 'finalize'
  | 'capability_widening'
  | 'unauthorized'
  | 'turn_active'
  | 'max_depth_exceeded'
  | 'join_error'
  | 'invalid_hunk_action'
  | 'hunk_action_failed'
  | 'hub_error'
  | 'shutting_down'
  | 'toolset_externally_owned'
  | 'unknown';

export interface RpcEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: RpcError;
}

export interface RpcError {
  code: RpcErrorCode | string;
  message: string;
}

/**
 * Create a success envelope.
 */
export function rpcOk<T>(data: T): RpcEnvelope<T> {
  return { ok: true, data };
}

/**
 * Create an error envelope.
 */
export function rpcErr<T>(code: string, message: string): RpcEnvelope<T> {
  return { ok: false, error: { code, message } };
}

/**
 * Get the wire code for a workspace error kind.
 */
export function getWireCode(errorKind: string): string {
  const codeMap: Record<string, string> = {
    parentSessionNotFound: 'parent_session_not_found',
    sessionNotFound: 'session_not_found',
    sessionAlreadyExists: 'session_already_exists',
    emptyAgentId: 'empty_agent_id',
    cannotDropMainSession: 'cannot_drop_main',
    finalize: 'finalize',
    capabilityWidening: 'capability_widening',
    unauthorized: 'unauthorized',
    turnActive: 'turn_active',
    maxDepthExceeded: 'max_depth_exceeded',
    joinError: 'join_error',
    invalidHunkAction: 'invalid_hunk_action',
    hunkActionFailed: 'hunk_action_failed',
    hubError: 'hub_error',
    shuttingDown: 'shutting_down',
    toolsetExternallyOwned: 'toolset_externally_owned',
  };

  return codeMap[errorKind] || 'unknown';
}

/**
 * Get the error kind from a wire code.
 */
export function getErrorKind(code: string): string {
  const kindMap: Record<string, string> = {
    parent_session_not_found: 'parentSessionNotFound',
    session_not_found: 'sessionNotFound',
    session_already_exists: 'sessionAlreadyExists',
    empty_agent_id: 'emptyAgentId',
    cannot_drop_main: 'cannotDropMainSession',
    finalize: 'finalize',
    capability_widening: 'capabilityWidening',
    unauthorized: 'unauthorized',
    turn_active: 'turnActive',
    max_depth_exceeded: 'maxDepthExceeded',
    join_error: 'joinError',
    invalid_hunk_action: 'invalidHunkAction',
    hunk_action_failed: 'hunkActionFailed',
    hub_error: 'hubError',
    shutting_down: 'shuttingDown',
    toolset_externally_owned: 'toolsetExternallyOwned',
  };

  return kindMap[code] || 'unknown';
}

/**
 * Parse an RPC error from a wire error.
 */
export function parseRpcError(error: RpcError): {
  kind: string;
  message: string;
  code: string;
} {
  return {
    kind: getErrorKind(error.code),
    message: error.message,
    code: error.code,
  };
}

/**
 * Create an RPC error from a workspace error.
 */
export function createRpcError(kind: string, message: string): RpcError {
  return {
    code: getWireCode(kind),
    message,
  };
}

/**
 * Check if an envelope contains an error.
 */
export function isRpcError<T>(envelope: RpcEnvelope<T>): envelope is RpcEnvelope<T> & { error: RpcError } {
  return !envelope.ok && envelope.error !== undefined;
}

/**
 * Unwrap an envelope, throwing on error.
 */
export function unwrapRpc<T>(envelope: RpcEnvelope<T>): T {
  if (isRpcError(envelope)) {
    throw new Error(`RPC Error [${envelope.error.code}]: ${envelope.error.message}`);
  }
  return envelope.data as T;
}
