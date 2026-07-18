/**
 * Permission resolution — resolves conflicting permission rules.
 *
 */

import { PermissionRule, Decision, AccessKind } from './types';
import { CompiledPolicy } from './policy';

export interface ResolvedPermission {
  decision: Decision;
  rules: PermissionRule[];
  source: string;
}

/**
 * Resolve permission from multiple rules using precedence:
 * deny > ask > allow
 */
export function resolvePermissions(
  rules: PermissionRule[],
  toolName: string,
  accessKind: AccessKind
): ResolvedPermission {
  let decision: Decision = { allowed: false, reason: 'no_rules' };
  const matchedRules: PermissionRule[] = [];

  for (const rule of rules) {
    if (matchesRule(rule, toolName, accessKind)) {
      matchedRules.push(rule);

      // Deny always wins
      if (rule.action === 'deny') {
        return { decision: { allowed: false, reason: 'rule_deny' }, rules: matchedRules, source: 'deny_rule' };
      }

      // Ask overrides allow
      if (rule.action === 'ask') {
        decision = { allowed: false, reason: 'rule_ask' };
      }

      // Allow (if no deny or ask yet)
      if (rule.action === 'allow' && decision.reason === 'no_rules') {
        decision = { allowed: true, reason: 'rule_allow' };
      }
    }
  }

  return { decision, rules: matchedRules, source: 'resolution' };
}

function matchesRule(
  rule: PermissionRule,
  toolName: string,
  accessKind: AccessKind
): boolean {
  // Tool filter matching
  if (rule.tool) {
    if (rule.tool === '*') return true;
    if (rule.tool !== toolName) return false;
  }

  // Access kind matching
  if (rule.accessKind && rule.accessKind !== accessKind) {
    return false;
  }

  return true;
}
