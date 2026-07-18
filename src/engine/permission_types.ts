/**
 * Permission types and access classification.
 */

export type AccessKind = 'read' | 'edit' | 'bash' | 'mcp' | 'web_fetch' | 'web_search';

export type Decision = 'allow' | 'deny' | 'ask';

export type EditPolicy = 'allow' | 'deny' | 'ask' | 'read_only';
export type PromptPolicy = 'allow' | 'deny' | 'ask';

export type PermissionMode = 'ask' | 'auto' | 'always-approve';

export type ClientType =
  | 'generic'
  | 'kairo-tui'
  | 'kairo-web'
  | 'nebula'
  | 'extension'
  | 'kairo-pager'
  | 'desktop';

export interface PermissionEvent {
  toolId: string;
  toolName: string;
  accessKind: AccessKind;
  accessDetail?: string;
  yoloMode: boolean;
  autoApproved: boolean;
  userPrompted: boolean;
  decision: string;
  promptOutcome?: string;
  rejectReason?: string;
  timestamp: string;
  subagentSessionId?: string;
  subagentType?: string;
  subagentDescription?: string;
  permissionMode?: string;
  decisionReason?: string;
  waitMs?: number;
  queueDepth?: number;
}

export interface PermissionGrant {
  toolName: string;
  accessKind: AccessKind;
  grantedAt: number;
  expiresAt?: number;
  scope: 'session' | 'persisted';
}

/**
 * Get the user agent label for a client type.
 */
export function getUserAgentLabel(clientType: ClientType): string {
  const labels: Record<ClientType, string> = {
    generic: 'kairo-shell',
    'kairo-tui': 'kairo-tui',
    'kairo-web': 'kairo-web',
    nebula: 'nebula',
    extension: 'kairo-code-extension',
    'kairo-pager': 'kairo-pager',
    desktop: 'kairo-desktop',
  };
  return labels[clientType];
}

/**
 * Create a permission event from context.
 */
export function createPermissionEvent(overrides: Partial<PermissionEvent>): PermissionEvent {
  return {
    toolId: '',
    toolName: '',
    accessKind: 'read',
    yoloMode: false,
    autoApproved: false,
    userPrompted: false,
    decision: 'allow',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}
