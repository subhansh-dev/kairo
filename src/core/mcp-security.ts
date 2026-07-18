/**
 * MCP security — MCP server security checks.
 */

export interface MCPSecurityCheck {
  serverName: string;
  command: string;
  args: string[];
  safe: boolean;
  warnings: string[];
}

/**
 * Check if an MCP server configuration is safe.
 */
export function checkMCPSecurity(config: { name: string; command: string; args?: string[] }): MCPSecurityCheck {
  const warnings: string[] = [];
  let safe = true;

  // Check for dangerous commands
  const dangerousCommands = ['rm', 'mkfs', 'dd', 'chmod', 'chown'];
  if (dangerousCommands.some(cmd => config.command.includes(cmd))) {
    warnings.push(`Command "${config.command}" is potentially dangerous`);
    safe = false;
  }

  // Check for shell injection in args
  const args = config.args || [];
  const dangerousArgs = ['&&', '||', ';', '|', '`', '$('];
  for (const arg of args) {
    if (dangerousArgs.some(d => arg.includes(d))) {
      warnings.push(`Argument "${arg}" contains shell metacharacters`);
      safe = false;
    }
  }

  // Check for network access
  if (config.command === 'npx' || config.command === 'node') {
    warnings.push('MCP server has Node.js execution capabilities');
  }

  return {
    serverName: config.name,
    command: config.command,
    args,
    safe,
    warnings,
  };
}

/**
 * Format MCP security check results.
 */
export function formatMCPSecurityCheck(check: MCPSecurityCheck): string {
  if (check.safe) return `✅ ${check.serverName}: Safe`;

  const lines = [`⚠️  ${check.serverName}: ${check.warnings.length} warning(s)`];
  for (const w of check.warnings) {
    lines.push(`  • ${w}`);
  }
  return lines.join('\n');
}
