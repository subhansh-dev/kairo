/**
 * Proxy CLI — proxy server CLI commands.
 */

export interface ProxyCommand {
  name: string;
  description: string;
  handler: (args: string[]) => Promise<void>;
}

// Proxy commands
const commands = new Map<string, ProxyCommand>();

/**
 * Register a proxy command.
 */
export function registerProxyCommand(command: ProxyCommand): void {
  commands.set(command.name, command);
}

/**
 * Get a proxy command by name.
 */
export function getProxyCommand(name: string): ProxyCommand | undefined {
  return commands.get(name);
}

/**
 * List all proxy commands.
 */
export function listProxyCommands(): ProxyCommand[] {
  return [...commands.values()];
}

/**
 * Format proxy commands for display.
 */
export function formatProxyCommands(): string {
  const cmds = listProxyCommands();
  if (cmds.length === 0) return 'No proxy commands available.';
  return cmds.map(c => `  ${c.name.padEnd(15)} ${c.description}`).join('\n');
}

// Register built-in commands
registerProxyCommand({
  name: 'start',
  description: 'Start the proxy server',
  handler: async (args) => { /* implementation */ },
});

registerProxyCommand({
  name: 'stop',
  description: 'Stop the proxy server',
  handler: async (args) => { /* implementation */ },
});

registerProxyCommand({
  name: 'status',
  description: 'Show proxy server status',
  handler: async (args) => { /* implementation */ },
});
