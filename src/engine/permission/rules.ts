/**
 * Permission rule DSL parser — parses "Bash(npm run build)" into PermissionRule.
 */

import type { PatternMode, PermissionRule, RuleAction, ToolFilter } from '../permission.js';

// ─── Default Permission Mode ───────────────────────────────

export type DefaultPermissionMode =
  | 'default' | 'accept_edits' | 'plan' | 'auto' | 'dont_ask' | 'bypass_permissions';

export interface DefaultModeEffects {
  promptPolicy: 'ask' | 'deny' | 'auto';
  acceptEdits: boolean;
  bypassPermissions: boolean;
}

export function getDefaultModeEffects(mode: DefaultPermissionMode): DefaultModeEffects {
  switch (mode) {
    case 'accept_edits': return { promptPolicy: 'ask', acceptEdits: true, bypassPermissions: false };
    case 'bypass_permissions': return { promptPolicy: 'ask', acceptEdits: true, bypassPermissions: true };
    case 'dont_ask': return { promptPolicy: 'deny', acceptEdits: false, bypassPermissions: false };
    case 'auto': return { promptPolicy: 'auto', acceptEdits: false, bypassPermissions: false };
    default: return { promptPolicy: 'ask', acceptEdits: false, bypassPermissions: false };
  }
}

// ─── Rule Parser ───────────────────────────────────────────

export function parsePermissionRule(rule: string, action: RuleAction): PermissionRule | null {
  const trimmed = rule.trim();

  const openParen = findFirstUnescaped(trimmed, '(');
  if (openParen !== null) {
    const prefix = trimmed.slice(0, openParen).trim();
    const rest = trimmed.slice(openParen + 1);
    const closeParen = findLastUnescaped(rest, ')');
    if (closeParen === null) return null;

    let rawContent = rest.slice(0, closeParen).trim();
    if (rawContent === '' || rawContent === '*') rawContent = '';

    const tool = toolNameToFilter(prefix);
    if (!tool) return null;

    let pattern = tool === 'bash' ? stripBashColonWildcard(rawContent) : rawContent;
    let patternMode: PatternMode = 'glob';

    if (pattern.startsWith('domain:')) {
      pattern = pattern.slice(7);
      patternMode = 'domain';
    }

    return {
      action,
      tool,
      pattern: pattern || undefined,
      patternMode,
    };
  }

  const tool = toolNameToFilter(trimmed);
  if (tool) {
    return { action, tool, pattern: undefined, patternMode: 'glob' };
  }

  return {
    action,
    tool: 'any',
    pattern: trimmed || undefined,
    patternMode: 'glob',
  };
}

// ─── Helpers ───────────────────────────────────────────────

function toolNameToFilter(name: string): ToolFilter | null {
  const map: Record<string, ToolFilter> = {
    Bash: 'bash', Read: 'read', NotebookRead: 'read',
    Edit: 'edit', Write: 'edit', NotebookEdit: 'edit',
    MCPTool: 'mcp', Grep: 'grep', Glob: 'grep',
    WebFetch: 'web_fetch', WebSearch: 'web_search',
  };
  return map[name] ?? null;
}

function findFirstUnescaped(s: string, target: string): number | null {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === target) {
      let backslashes = 0;
      let j = i;
      while (j > 0 && s[j - 1] === '\\') { backslashes++; j--; }
      if (backslashes % 2 === 0) return i;
    }
  }
  return null;
}

function findLastUnescaped(s: string, target: string): number | null {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === target) {
      let backslashes = 0;
      let j = i;
      while (j > 0 && s[j - 1] === '\\') { backslashes++; j--; }
      if (backslashes % 2 === 0) return i;
    }
  }
  return null;
}

function stripBashColonWildcard(pattern: string): string {
  if (pattern.endsWith(':*')) return pattern.slice(0, -2);
  return pattern;
}
