/**
 * Tool protection — prevent dangerous tool operations.
 */

export interface ProtectionResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}

// Tools that require explicit approval
const REQUIRES_APPROVAL = new Set([
  'write', 'edit', 'exec', 'git',
]);

// Commands that are always blocked
const BLOCKED_COMMANDS = [
  /\brm\s+-rf\s+\/\b/,         // rm -rf /
  /\b:(){ :|:& };:/,            // fork bomb
  /\bmkfs\b/,                   // format disk
  /\bdd\b.*of=\/dev/,           // write to device
  /\bchmod\b.*-R\s+777\s+\//,  // chmod everything
  />\s*\/dev\/sd[a-z]/,         // write to disk device
];

// Files that should never be written to
const PROTECTED_FILES = new Set([
  '/etc/passwd', '/etc/shadow', '/etc/sudoers',
  '/proc', '/sys', '/dev',
]);

/**
 * Check if a tool operation requires approval.
 */
export function checkToolProtection(toolName: string, args: Record<string, unknown>): ProtectionResult {
  // Always allow read-only tools
  if (['read', 'grep', 'glob', 'ls'].includes(toolName)) {
    return { allowed: true, requiresApproval: false };
  }

  // Check if tool requires approval
  const requiresApproval = REQUIRES_APPROVAL.has(toolName);

  // Check exec commands for dangerous patterns
  if (toolName === 'exec' && typeof args.command === 'string') {
    const cmd = args.command;
    for (const pattern of BLOCKED_COMMANDS) {
      if (pattern.test(cmd)) {
        return { allowed: false, reason: `Blocked dangerous command: ${pattern.source}`, requiresApproval: true };
      }
    }
  }

  // Check write/edit for protected files
  if ((toolName === 'write' || toolName === 'edit') && typeof args.path === 'string') {
    const path = args.path;
    for (const protectedFile of PROTECTED_FILES) {
      if (path.startsWith(protectedFile)) {
        return { allowed: false, reason: `Blocked write to protected path: ${protectedFile}`, requiresApproval: true };
      }
    }
  }

  return { allowed: true, requiresApproval };
}

/**
 * Check if a command is safe to auto-approve.
 */
export function isAutoApprovable(toolName: string, args: Record<string, unknown>): boolean {
  const result = checkToolProtection(toolName, args);
  return result.allowed && !result.requiresApproval;
}
