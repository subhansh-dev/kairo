/**
 * Kairo — Tool Use Approval System
 * Manages permission tiers, auto-approval rules, user confirmation
 */

import type { ToolDefinition, PermissionDecision, ToolTier } from '../tools/types.js';

// ─── Approval Mode ──────────────────────────────────────────────

export type ApprovalMode = 'always' | 'moderate' | 'strict';

export interface ApprovalConfig {
  mode: ApprovalMode;
  autoApproveReads: boolean;
  autoApproveWrites: boolean;
  /** Auto-approve specific tool names */
  autoApproveTools: string[];
  /** Tools that always require confirmation */
  alwaysConfirmTools: string[];
  /** Max output length before requiring confirmation */
  largeOutputThreshold: number;
}

const DEFAULT_CONFIG: ApprovalConfig = {
  mode: 'moderate',
  autoApproveReads: true,
  autoApproveWrites: false,
  autoApproveTools: ['read', 'grep', 'glob', 'ls'],
  alwaysConfirmTools: ['edit', 'write', 'exec'],
  largeOutputThreshold: 100_000,
};

let approvalConfig: ApprovalConfig = { ...DEFAULT_CONFIG };

// ─── Approval Request ───────────────────────────────────────────

export interface ApprovalRequest {
  toolName: string;
  args: string;
  tier: ToolTier;
  reason: string;
  pending: boolean;
  approved: boolean;
  timestamp: number;
}

const pendingApprovals: ApprovalRequest[] = [];

// ─── Config Management ──────────────────────────────────────────

export function setApprovalConfig(config: Partial<ApprovalConfig>): void {
  approvalConfig = { ...approvalConfig, ...config };
}

export function getApprovalConfig(): ApprovalConfig {
  return { ...approvalConfig };
}

// ─── Decision Logic ─────────────────────────────────────────────

/**
 * Check if a tool call needs approval.
 * Returns a PermissionDecision with optional override flag.
 */
export function checkToolApproval(
  tool: ToolDefinition,
  args: string,
  isUserConfirmed?: boolean,
): PermissionDecision {
  // If user already confirmed, allow
  if (isUserConfirmed) {
    return { allowed: true };
  }

  // Strict mode: almost everything needs approval
  if (approvalConfig.mode === 'strict') {
    if (tool.readOnly || approvalConfig.autoApproveTools.includes(tool.name)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Approval required (strict mode): ${tool.name}`, override: true };
  }

  // Always mode: auto-approve everything
  if (approvalConfig.mode === 'always') {
    return { allowed: true };
  }

  // Moderate mode (default)
  if (approvalConfig.autoApproveTools.includes(tool.name)) {
    return { allowed: true };
  }

  if (tool.readOnly || tool.tier === 'read') {
    if (approvalConfig.autoApproveReads) {
      return { allowed: true };
    }
  }

  if (approvalConfig.alwaysConfirmTools.includes(tool.name)) {
    return { allowed: false, reason: `${tool.name} requires confirmation`, override: true };
  }

  // Check if write ops are auto-approved
  if (tool.tier === 'write' || tool.tier === 'exec') {
    if (approvalConfig.autoApproveWrites) {
      return { allowed: true };
    }
    return { allowed: false, reason: `${tool.name} (${tool.tier}) requires approval` };
  }

  return { allowed: true };
}

/**
 * Parse user input as an approval response
 */
export function parseApprovalResponse(input: string): 'yes' | 'no' | 'always' | 'never' | null {
  const trimmed = input.trim().toLowerCase();
  if (['y', 'yes', 'approve', 'allow', 'ok', 'yep', 'yeah', 'sure'].includes(trimmed)) return 'yes';
  if (['n', 'no', 'deny', 'reject', 'block', 'nope'].includes(trimmed)) return 'no';
  if (['ya', 'always', 'forever', 'aa'].includes(trimmed)) return 'always';
  if (['nn', 'never', 'blocked'].includes(trimmed)) return 'never';
  return null;
}

// ─── Pending Approvals Queue ────────────────────────────────────

export function createApprovalRequest(
  toolName: string,
  args: string,
  tier: ToolTier,
  reason: string,
): ApprovalRequest {
  const request: ApprovalRequest = {
    toolName,
    args,
    tier,
    reason,
    pending: true,
    approved: false,
    timestamp: Date.now(),
  };
  pendingApprovals.push(request);
  return request;
}

export function resolveApproval(request: ApprovalRequest, approved: boolean): void {
  request.pending = false;
  request.approved = approved;
}

export function getPendingApprovals(): ApprovalRequest[] {
  return pendingApprovals.filter(a => a.pending);
}

export function clearApprovals(): void {
  pendingApprovals.length = 0;
}

// ─── Request Approval from User ─────────────────────────────────

/**
 * Format an approval request as a string for the UI
 */
export function formatApprovalRequest(request: ApprovalRequest): string {
  const preview = request.args.length > 80
    ? request.args.slice(0, 80) + '...'
    : request.args;
  return `\n[APPROVAL] ${request.tier.toUpperCase()}: ${request.toolName}\n  ${preview}\n  Reason: ${request.reason}\n  Allow? (y/n/ya/aa/nn) `;
}

// ─── Fast-Path Classification ───────────────────────────────────

/**
 * Classify a tool call for the approval system
 * Returns the tier and a human-readable description
 */
export function classifyToolCall(tool: ToolDefinition): { tier: ToolTier; description: string } {
  if (tool.destructive) return { tier: 'exec', description: 'DESTRUCTIVE' };
  if (!tool.readOnly && tool.tier === 'write') return { tier: 'write', description: 'WRITE' };
  if (!tool.readOnly && tool.tier === 'exec') return { tier: 'exec', description: 'EXEC' };
  if (tool.readOnly || tool.tier === 'read') return { tier: 'read', description: 'READ' };
  return { tier: tool.tier, description: tool.tier.toUpperCase() };
}
