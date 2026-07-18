/**
 * Permission types — access kinds, decisions, events, modes.
 *
 */

export enum AccessKind {
  Bash = 'bash',
  Read = 'read',
  Write = 'write',
  Edit = 'edit',
  WebFetch = 'web_fetch',
  Mcp = 'mcp',
}

export interface Decision {
  allowed: boolean;
  reason: string;
}

export enum EditPolicy {
  Allow = 'allow',
  Deny = 'deny',
  Ask = 'ask',
}

export enum PromptPolicy {
  Allow = 'allow',
  Deny = 'deny',
  Ask = 'ask',
}

export interface ToolFilter {
  tool: string;
  pattern?: string;
}

export enum PatternMode {
  Exact = 'exact',
  Glob = 'glob',
  Regex = 'regex',
}

export enum RuleAction {
  Allow = 'allow',
  Deny = 'deny',
  Ask = 'ask',
}

export interface PermissionRule {
  action: RuleAction;
  tool?: string;
  accessKind?: AccessKind;
  pattern?: string;
  patternMode?: PatternMode;
}

export interface PermissionConfig {
  rules: PermissionRule[];
  defaultMode: string;
}

export interface PermissionState {
  grants: Map<string, boolean>;
  denials: Map<string, boolean>;
}

export interface PermissionEvent {
  id?: string;
  tool: string;
  accessKind: AccessKind;
  path?: string;
  command?: string;
  sessionId?: string;
}

export enum PermissionMode {
  Default = 'default',
  Auto = 'auto',
  Ask = 'ask',
  AlwaysApprove = 'always_approve',
}

export enum ClientType {
  Terminal = 'terminal',
  VSCode = 'vscode',
  Web = 'web',
  Unknown = 'unknown',
}
