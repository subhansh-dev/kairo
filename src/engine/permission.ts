/**
 * Permission system types — tool access classification, policy rules, decisions.
 * Permission system types — tool access classification, policy rules, decisions.
 */

type ToolKind = 'read' | 'edit' | 'delete' | 'write' | 'move' | 'list_dir' | 'list' | 'search' | 'lsp' | 'execute' | 'plan' | 'web_search' | 'web_fetch' | 'background_task_action' | 'wait_tasks_action' | 'kill_task_action' | 'skill' | 'memory_search' | 'memory_get' | 'task' | 'enter_plan' | 'exit_plan' | 'ask_user' | 'image_gen' | 'video_gen' | 'image_to_video' | 'reference_to_video' | 'deploy_app' | 'search_tool' | 'use_tool' | 'monitor' | 'goal_update' | 'other';

// ─── Access Classification ─────────────────────────────────

export type AccessKind =
  | { type: 'read'; path?: string }
  | { type: 'grep'; path?: string; glob?: string }
  | { type: 'edit'; path: string }
  | { type: 'bash'; command: string }
  | { type: 'mcp_tool'; name: string; input: unknown }
  | { type: 'web_fetch'; url: string }
  | { type: 'web_search'; query: string };

// ─── Decisions ─────────────────────────────────────────────

export type Decision =
  | { type: 'allow' }
  | { type: 'ask' }
  | { type: 'followup'; message: string }
  | { type: 'reject'; reason: string }
  | { type: 'policy_deny'; reason: string }
  | { type: 'cancelled' };

// ─── Edit Policy ───────────────────────────────────────────

export type EditPolicy = 'ask' | 'allow' | 'reject';

// ─── Prompt Policy ─────────────────────────────────────────

export type PromptPolicy = 'ask' | 'deny' | 'auto';

// ─── Permission Rules ──────────────────────────────────────

export type ToolFilter = 'any' | 'bash' | 'edit' | 'read' | 'grep' | 'mcp' | 'web_fetch' | 'web_search';
export type PatternMode = 'glob' | 'domain';
export type RuleAction = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  action: RuleAction;
  tool: ToolFilter;
  pattern?: string;
  patternMode: PatternMode;
}

export interface PermissionConfig {
  rules: PermissionRule[];
  promptPolicy: PromptPolicy;
}

// ─── Permission State ──────────────────────────────────────

export interface PermissionState {
  editPolicy: EditPolicy;
  allowBashExecute: boolean;
  allowedBashCommands: string[];
  disallowedBashCommands: string[];
  allowedWebFetchDomains: string[];
  allowedMcpTools: string[];
  allowedMcpServers: string[];
}

// ─── Permission Event ──────────────────────────────────────

export interface PermissionEvent {
  toolId: string;
  toolName: string;
  accessKind: string;
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

// ─── Client Type ───────────────────────────────────────────

export type ClientType = 'generic' | 'tui' | 'web' | 'nebula' | 'extension' | 'pager' | 'desktop';

export function clientTypeFromIdentifier(id?: string): ClientType {
  switch (id) {
    case 'kairo-web': return 'web';
    case 'nebula': return 'nebula';
    case 'kairo-code-extension': return 'extension';
    case 'kairo-desktop': return 'desktop';
    case 'kairo-pager': return 'pager';
    default: return 'generic';
  }
}

// ─── Safe Commands ─────────────────────────────────────────

const ALWAYS_SAFE = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'which', 'whoami',
  'date', 'env', 'printenv', 'uname', 'hostname', 'id', 'groups',
  'file', 'stat', 'du', 'df', 'free', 'uptime', 'ps', 'top', 'htop',
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'git remote', 'git tag', 'git describe',
]);

const DANGEROUS = new Set([
  'rm', 'rm -rf', 'sudo', 'chmod', 'chown', 'mkfs', 'dd',
  'shutdown', 'reboot', 'halt', 'init', 'kill', 'killall',
  'pkill', 'kill -9', ':(){', 'fork',
]);

export function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();
  for (const safe of ALWAYS_SAFE) {
    if (trimmed === safe || trimmed.startsWith(safe + ' ')) return true;
  }
  return false;
}

export function isDangerousCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  for (const danger of DANGEROUS) {
    if (trimmed.includes(danger)) return true;
  }
  return false;
}

// ─── Rule Evaluation Helpers ───────────────────────────────

export function toolFilterMatches(filter: ToolFilter, toolKind: ToolKind): boolean {
  if (filter === 'any') return true;
  const map: Record<ToolFilter, string[]> = {
    any: [],
    bash: ['execute'],
    edit: ['edit', 'write', 'move', 'delete'],
    read: ['read', 'list_dir', 'list'],
    grep: ['search'],
    mcp: [],
    web_fetch: ['web_fetch'],
    web_search: ['web_search'],
  };
  return map[filter]?.includes(toolKind) ?? false;
}

export function globMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\{\{GLOBSTAR\}\}/g, '.*') +
    '$'
  );
  return regex.test(value);
}

export function domainMatch(pattern: string, url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === pattern || hostname.endsWith('.' + pattern);
  } catch {
    return false;
  }
}

export function evaluatePermission(
  rules: PermissionRule[],
  toolKind: ToolKind,
  detail: string,
): Decision {
  for (const rule of rules) {
    if (!toolFilterMatches(rule.tool, toolKind)) continue;

    if (rule.pattern) {
      const matches =
        rule.patternMode === 'domain'
          ? domainMatch(rule.pattern, detail)
          : globMatch(rule.pattern, detail);

      if (!matches) continue;
    }

    switch (rule.action) {
      case 'deny':
        return { type: 'policy_deny', reason: `denied by rule: ${rule.tool}/${rule.pattern ?? '*'}` };
      case 'ask':
        return { type: 'ask' };
      case 'allow':
        return { type: 'allow' };
    }
  }

  return { type: 'ask' };
}

export function parsePermissionRule(ruleString: string): PermissionRule | null {
  const trimmed = ruleString.trim();

  // Pattern: "Tool(pattern)" or "Tool"
  const match = trimmed.match(/^(\w+)(?:\(([^)]+)\))?$/);
  if (!match) return null;

  const [, toolName, pattern] = match;
  const tool = parseToolFilter(toolName);
  if (!tool) return null;

  return {
    action: 'allow',
    tool,
    pattern: pattern || undefined,
    patternMode: tool === 'web_fetch' || tool === 'web_search' ? 'domain' : 'glob',
  };
}

function parseToolFilter(name: string): ToolFilter | null {
  const map: Record<string, ToolFilter> = {
    Bash: 'bash', Edit: 'edit', Read: 'read', Grep: 'grep',
    MCPTool: 'mcp', WebFetch: 'web_fetch', WebSearch: 'web_search',
  };
  return map[name] ?? null;
}

export function defaultPermissionConfig(): PermissionConfig {
  return {
    rules: [],
    promptPolicy: 'ask',
  };
}

export function defaultPermissionState(): PermissionState {
  return {
    editPolicy: 'ask',
    allowBashExecute: false,
    allowedBashCommands: [],
    disallowedBashCommands: [],
    allowedWebFetchDomains: [],
    allowedMcpTools: [],
    allowedMcpServers: [],
  };
}
