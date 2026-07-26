/**
 * Subcommands — CLI subcommand management.
 */

export interface Subcommand {
  name: string;
  description: string;
  handler: (args: string[]) => Promise<void>;
  options?: Array<{ flag: string; description: string; required?: boolean }>;
}

// Registered subcommands
const subcommands = new Map<string, Subcommand>();

/**
 * Register a subcommand.
 */
export function registerSubcommand(command: Subcommand): void {
  subcommands.set(command.name, command);
}

/**
 * Get a subcommand by name.
 */
export function getSubcommand(name: string): Subcommand | undefined {
  return subcommands.get(name);
}

/**
 * List all subcommands.
 */
export function listSubcommands(): Subcommand[] {
  return [...subcommands.values()];
}

/**
 * Format subcommands for help display.
 */
export function formatSubcommands(): string {
  const cmds = listSubcommands();
  if (cmds.length === 0) return 'No subcommands available.';
  return cmds.map(c => `  ${c.name.padEnd(15)} ${c.description}`).join('\n');
}

/**
 * Parse subcommand arguments.
 */
export function parseSubcommandArgs(args: string[]): { command: string; args: string[]; flags: Record<string, string> } {
  const command = args[0] || '';
  const remaining: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const flag = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[flag] = value;
    } else {
      remaining.push(args[i]);
    }
  }

  return { command, args: remaining, flags };
}

// Register built-in subcommands
registerSubcommand({
  name: 'help',
  description: 'Show help information',
  handler: async (args) => { /* implementation */ },
});

registerSubcommand({
  name: 'version',
  description: 'Show version information',
  handler: async (args) => { /* implementation */ },
});
