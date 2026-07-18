/**
 * Skill commands — slash command integration for skills.
 */

export interface SkillCommand {
  name: string;
  description: string;
  skillName: string;
  handler: (args: string) => Promise<string>;
}

// Registered skill commands
const commands = new Map<string, SkillCommand>();

/**
 * Register a skill command.
 */
export function registerSkillCommand(command: SkillCommand): void {
  commands.set(command.name, command);
}

/**
 * Get a skill command by name.
 */
export function getSkillCommand(name: string): SkillCommand | undefined {
  return commands.get(name);
}

/**
 * List all skill commands.
 */
export function listSkillCommands(): SkillCommand[] {
  return [...commands.values()];
}

/**
 * Check if a string is a skill command.
 */
export function isSkillCommand(input: string): boolean {
  const name = input.startsWith('/') ? input.slice(1).split(/\s+/)[0] : input.split(/\s+/)[0];
  return commands.has(name);
}

/**
 * Execute a skill command.
 */
export function executeSkillCommand(input: string): Promise<string> | null {
  const name = input.startsWith('/') ? input.slice(1).split(/\s+/)[0] : input.split(/\s+/)[0];
  const command = commands.get(name);
  if (!command) return null;

  const args = input.slice(name.length + (input.startsWith('/') ? 1 : 0)).trim();
  return command.handler(args);
}

/**
 * Unregister a skill command.
 */
export function unregisterSkillCommand(name: string): boolean {
  return commands.delete(name);
}

/**
 * Clear all skill commands.
 */
export function clearSkillCommands(): void {
  commands.clear();
}

/**
 * Format skill commands for help display.
 */
export function formatSkillCommands(): string {
  const cmds = listSkillCommands();
  if (cmds.length === 0) return 'No skill commands registered.';
  return cmds.map(c => `  /${c.name} — ${c.description}`).join('\n');
}
