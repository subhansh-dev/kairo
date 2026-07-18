/**
 * System prompt builder — build system prompts for agents.
 */

export interface SystemPromptParts {
  identity: string;
  tools: string;
  context: string;
  skills: string;
  rules: string;
}

/**
 * Build a complete system prompt from parts.
 */
export function buildSystemPrompt(parts: SystemPromptParts): string {
  const sections = [parts.identity];

  if (parts.tools) sections.push(`## Tools\n${parts.tools}`);
  if (parts.context) sections.push(`## Context\n${parts.context}`);
  if (parts.skills) sections.push(`## Skills\n${parts.skills}`);
  if (parts.rules) sections.push(`## Rules\n${parts.rules}`);

  return sections.join('\n\n');
}

/**
 * Build a tool list for the system prompt.
 */
export function buildToolList(tools: Array<{ name: string; description: string; readOnly?: boolean; destructive?: boolean }>): string {
  return tools.map(t => {
    const safety = t.readOnly ? ' [read-only]' : t.destructive ? ' [destructive]' : '';
    return `  ${t.name} — ${t.description}${safety}`;
  }).join('\n');
}

/**
 * Build the identity section.
 */
export function buildIdentity(name: string, role: string): string {
  return `You are ${name}, ${role}. Use tools to solve problems. Don't describe what you would do — do it.`;
}

/**
 * Build rules section from a list of rules.
 */
export function buildRules(rules: string[]): string {
  return rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
}
