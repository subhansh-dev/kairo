/**
 * Completion — tab completion utilities.
 */

/**
 * Complete a command name from partial input.
 */
export function completeCommand(partial: string, commands: string[]): string[] {
  const lower = partial.toLowerCase();
  return commands.filter(cmd => cmd.toLowerCase().startsWith(lower));
}

/**
 * Complete a file path from partial input.
 */
export function completePath(partial: string, root?: string): string[] {
  const { readdirSync, statSync } = require('fs');
  const { join, dirname, resolve } = require('path');

  const dir = partial.includes('/') ? dirname(partial) : '.';
  const prefix = partial.includes('/') ? partial.split('/').pop() || '' : partial;
  const searchDir = root ? resolve(root, dir) : resolve(dir);

  try {
    const entries = readdirSync(searchDir);
    return entries
      .filter((e: string) => e.startsWith(prefix))
      .map((e: string) => {
        const fullPath = join(searchDir, e);
        const isDir = statSync(fullPath).isDirectory();
        return join(dir, e) + (isDir ? '/' : '');
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Complete a tool name from partial input.
 */
export function completeTool(partial: string, tools: string[]): string[] {
  // Remove ! prefix if present
  const clean = partial.startsWith('!') ? partial.slice(1) : partial;
  const lower = clean.toLowerCase();
  return tools.filter(t => t.toLowerCase().startsWith(lower)).map(t => `!${t}`);
}

/**
 * Complete a slash command from partial input.
 */
export function completeSlashCommand(partial: string, commands: string[]): string[] {
  const clean = partial.startsWith('/') ? partial : `/${partial}`;
  const lower = clean.toLowerCase();
  return commands.filter(cmd => cmd.toLowerCase().startsWith(lower));
}

/**
 * Build completion candidates for a given input context.
 */
export function getCompletionCandidates(input: string, context: {
  commands?: string[];
  tools?: string[];
  slashCommands?: string[];
}): string[] {
  // If input starts with /, complete slash commands
  if (input.startsWith('/')) {
    return completeSlashCommand(input, context.slashCommands || []);
  }

  // If input starts with !, complete tools
  if (input.startsWith('!')) {
    return completeTool(input, context.tools || []);
  }

  // Default to command completion
  return completeCommand(input, context.commands || []);
}
