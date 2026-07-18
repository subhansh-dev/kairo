/**
 * ACP (Agent Communication Protocol) — message types, gateway, and routing.
 * Ported from the Rust ACP library. Provides agent↔client communication primitives.
 */

// ─── Result Types ──────────────────────────────────────────

export type AcpResult<T> = { ok: true; value: T } | { ok: false; error: AcpError };

export interface AcpError {
  code: number;
  message: string;
  data?: unknown;
}

export function acpOk<T>(value: T): AcpResult<T> {
  return { ok: true, value };
}

export function acpErr<T>(code: number, message: string, data?: unknown): AcpResult<T> {
  return { ok: false, error: { code, message, data } };
}

// ─── Method Names ──────────────────────────────────────────

export const ACP_AGENT_METHODS = {
  initialize: 'initialize',
  authenticate: 'authenticate',
  session_new: 'session/new',
  session_load: 'session/load',
  session_set_mode: 'session/set_mode',
  session_prompt: 'session/prompt',
  session_cancel: 'session/cancel',
  session_set_model: 'session/set_model',
} as const;

export const ACP_CLIENT_METHODS = {
  session_request_permission: 'session/request_permission',
  session_update: 'session/update',
  fs_read_text_file: 'fs/read_text_file',
  fs_write_text_file: 'fs/write_text_file',
  terminal_create: 'terminal/create',
  terminal_output: 'terminal/output',
  terminal_release: 'terminal/release',
  terminal_wait_for_exit: 'terminal/wait_for_exit',
  terminal_kill: 'terminal/kill',
} as const;

// ─── Request/Response Types ────────────────────────────────

export interface InitializeRequest {
  protocolVersion: string;
  clientInfo?: { name: string; version: string };
  capabilities?: Record<string, unknown>;
}

export interface InitializeResponse {
  protocolVersion: string;
  agentInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
}

export interface AuthenticateRequest {
  authInfo: Record<string, unknown>;
}

export interface AuthenticateResponse {
  authenticated: boolean;
}

export interface NewSessionRequest {
  mode?: string;
  model?: string;
  sessionId?: string;
}

export interface NewSessionResponse {
  sessionId: string;
  mode: string;
}

export interface LoadSessionRequest {
  sessionId: string;
}

export interface LoadSessionResponse {
  sessionId: string;
  messages: AcpMessage[];
}

export interface SetSessionModeRequest {
  sessionId: string;
  mode: string;
}

export interface SetSessionModeResponse {
  mode: string;
}

export interface AcpPromptRequest {
  sessionId: string;
  prompt: string;
  images?: Array<{ data: string; mimeType: string }>;
}

export interface PromptResponse {
  sessionId: string;
  content: AcpContentBlock[];
}

export interface CancelNotification {
  sessionId: string;
}

export interface SetSessionModelRequest {
  sessionId: string;
  model: string;
}

export interface SetSessionModelResponse {
  model: string;
}

// ─── Client Methods ────────────────────────────────────────

export interface RequestPermissionRequest {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface RequestPermissionResponse {
  approved: boolean;
}

export interface ReadTextFileRequest {
  path: string;
  line?: number;
  limit?: number;
}

export interface ReadTextFileResponse {
  content: string;
  lines?: number;
}

export interface WriteTextFileRequest {
  path: string;
  content: string;
  line?: number;
  limit?: number;
}

export interface WriteTextFileResponse {
  written: boolean;
}

export interface SessionNotification {
  sessionId: string;
  update: SessionUpdate;
}

export type SessionUpdate =
  | { type: 'agent_message_chunk'; content: AcpContentBlock }
  | { type: 'agent_message_end' }
  | { type: 'tool_use_start'; toolName: string }
  | { type: 'tool_use_end'; toolName: string; output?: string }
  | { type: 'thinking'; content: string }
  | { type: 'status'; message: string };

export interface CreateTerminalRequest {
  sessionId: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface CreateTerminalResponse {
  terminalId: string;
}

export interface TerminalOutputRequest {
  terminalId: string;
  afterSequenceNumber?: number;
}

export interface TerminalOutputResponse {
  output: string;
  sequenceNumber: number;
  exitCode?: number;
}

export interface ReleaseTerminalRequest {
  terminalId: string;
}

export interface ReleaseTerminalResponse {
  released: boolean;
}

export interface WaitForTerminalExitRequest {
  terminalId: string;
}

export interface WaitForTerminalExitResponse {
  exitCode: number;
}

export interface KillTerminalRequest {
  terminalId: string;
  signal?: string;
}

export interface KillTerminalResponse {
  killed: boolean;
}

// ─── Content Blocks ────────────────────────────────────────

export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content?: string; isError?: boolean }
  | { type: 'image'; data: string; mimeType: string };

export interface AcpMessage {
  role: 'user' | 'assistant';
  content: AcpContentBlock[];
}

// ─── Gateway ───────────────────────────────────────────────

export interface AcpChannel<T> {
  send(message: T): void;
  receive(): Promise<T | null>;
  close(): void;
}

/**
 * Create an unbounded ACP channel.
 */
export function createAcpChannel<T>(): AcpChannel<T> {
  const queue: T[] = [];
  let waiters: Array<(value: T | null) => void> = [];
  let closed = false;

  return {
    send(message: T) {
      if (closed) return;
      if (waiters.length > 0) {
        const waiter = waiters.shift()!;
        waiter(message);
      } else {
        queue.push(message);
      }
    },

    async receive(): Promise<T | null> {
      if (closed) return null;
      if (queue.length > 0) {
        return queue.shift()!;
      }
      return new Promise(resolve => {
        waiters.push(resolve);
      });
    },

    close() {
      closed = true;
      for (const waiter of waiters) waiter(null);
      waiters = [];
    },
  };
}

// ─── Message Routing ───────────────────────────────────────

export type AcpAgentMessage =
  | { type: 'initialize'; request: InitializeRequest }
  | { type: 'authenticate'; request: AuthenticateRequest }
  | { type: 'new_session'; request: NewSessionRequest }
  | { type: 'load_session'; request: LoadSessionRequest }
  | { type: 'set_session_mode'; request: SetSessionModeRequest }
  | { type: 'prompt'; request: AcpPromptRequest }
  | { type: 'cancel'; request: CancelNotification }
  | { type: 'set_session_model'; request: SetSessionModelRequest }
  | { type: 'ext_method'; method: string; request: unknown }
  | { type: 'ext_notification'; method: string; request: unknown };

export type AcpClientMessage =
  | { type: 'request_permission'; request: RequestPermissionRequest }
  | { type: 'read_text_file'; request: ReadTextFileRequest }
  | { type: 'write_text_file'; request: WriteTextFileRequest }
  | { type: 'session_notification'; request: SessionNotification }
  | { type: 'create_terminal'; request: CreateTerminalRequest }
  | { type: 'terminal_output'; request: TerminalOutputRequest }
  | { type: 'release_terminal'; request: ReleaseTerminalRequest }
  | { type: 'wait_for_terminal_exit'; request: WaitForTerminalExitRequest }
  | { type: 'kill_terminal'; request: KillTerminalRequest }
  | { type: 'ext_method'; method: string; request: unknown }
  | { type: 'ext_notification'; method: string; request: unknown };

/**
 * Get the method name for an ACP message.
 */
export function acpMethodName(msg: AcpAgentMessage | AcpClientMessage): string {
  switch (msg.type) {
    case 'initialize': return ACP_AGENT_METHODS.initialize;
    case 'authenticate': return ACP_AGENT_METHODS.authenticate;
    case 'new_session': return ACP_AGENT_METHODS.session_new;
    case 'load_session': return ACP_AGENT_METHODS.session_load;
    case 'set_session_mode': return ACP_AGENT_METHODS.session_set_mode;
    case 'prompt': return ACP_AGENT_METHODS.session_prompt;
    case 'cancel': return ACP_AGENT_METHODS.session_cancel;
    case 'set_session_model': return ACP_AGENT_METHODS.session_set_model;
    case 'request_permission': return ACP_CLIENT_METHODS.session_request_permission;
    case 'read_text_file': return ACP_CLIENT_METHODS.fs_read_text_file;
    case 'write_text_file': return ACP_CLIENT_METHODS.fs_write_text_file;
    case 'session_notification': return ACP_CLIENT_METHODS.session_update;
    case 'create_terminal': return ACP_CLIENT_METHODS.terminal_create;
    case 'terminal_output': return ACP_CLIENT_METHODS.terminal_output;
    case 'release_terminal': return ACP_CLIENT_METHODS.terminal_release;
    case 'wait_for_terminal_exit': return ACP_CLIENT_METHODS.terminal_wait_for_exit;
    case 'kill_terminal': return ACP_CLIENT_METHODS.terminal_kill;
    case 'ext_method': return msg.method;
    case 'ext_notification': return msg.method;
  }
}
