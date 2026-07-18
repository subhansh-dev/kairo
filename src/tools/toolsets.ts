/**
 * Kairo — Toolsets
 * Flexible system for grouping tools for different scenarios.
 * Allows composing tool groups from individual tools or other toolsets.
 *
 * Example: "coding" = terminal + read + write + edit + grep + git
 *          "research" = web_search + web_fetch + browser
 *          "full_stack" = coding + research + memory
 */

// ─── Types ─────────────────────────────────────────────────

export interface Toolset {
  name: string;
  tools: string[];
  description?: string;
}

// ─── Tool Definitions ──────────────────────────────────────

const TOOLS = {
  // File operations
  read: 'read',
  write: 'write',
  edit: 'edit',
  search: 'search',
  glob: 'glob',

  // Execution
  terminal: 'terminal',
  bash: 'bash',

  // Web
  web_search: 'web_search',
  web_fetch: 'web_fetch',
  browser: 'browser',

  // Git
  git: 'git',

  // Memory
  memory: 'memory',
  todo: 'todo',
  session_search: 'session_search',

  // Agent
  agent: 'agent',
  clarify: 'clarify',

  // Planning
  plan: 'plan',
  skill: 'skill',

  // Tasks
  task_create: 'task_create',
  task_list: 'task_list',
  task_get: 'task_get',
  task_update: 'task_update',
  task_output: 'task_output',
  task_stop: 'task_stop',

  // Code review
  review_artifact: 'review_artifact',
  suggest_pr: 'suggest_pr',
} as const;

// ─── Toolset Definitions ───────────────────────────────────

const TOOLSETS: Record<string, string[]> = {
  // Core file operations
  file: [TOOLS.read, TOOLS.write, TOOLS.edit, TOOLS.search, TOOLS.glob],

  // Terminal execution
  exec: [TOOLS.terminal, TOOLS.bash],

  // Web research
  web: [TOOLS.web_search, TOOLS.web_fetch, TOOLS.browser],

  // Git operations
  git: [TOOLS.git],

  // Memory and context
  memory: [TOOLS.memory, TOOLS.todo, TOOLS.session_search],

  // Planning and skills
  planning: [TOOLS.plan, TOOLS.skill],

  // Task management
  tasks: [TOOLS.task_create, TOOLS.task_list, TOOLS.task_get, TOOLS.task_update, TOOLS.task_output, TOOLS.task_stop],

  // Code review
  review: [TOOLS.review_artifact, TOOLS.suggest_pr],

  // Agent delegation
  agent: [TOOLS.agent, TOOLS.clarify],

  // Composite: coding workflow
  coding: [...new Set([
    ...['file'],
    ...['exec'],
    ...['git'],
    ...['memory'],
    ...['planning'],
  ])].flatMap(t => TOOLSETS[t] || [t]),

  // Composite: research workflow
  research: [...new Set([
    ...['web'],
    ...['memory'],
  ])].flatMap(t => TOOLSETS[t] || [t]),

  // Composite: full stack (everything)
  full: [...new Set([
    ...['file', 'exec', 'git', 'web', 'memory', 'planning', 'tasks', 'review', 'agent'],
  ])].flatMap(t => TOOLSETS[t] || [t]),
};

// ─── API ───────────────────────────────────────────────────

/**
 * Get the list of tool names for a toolset.
 * Supports composition: "coding" expands to file + exec + git + memory + planning.
 */
export function getToolset(name: string): string[] {
  return TOOLSETS[name] || [];
}

/**
 * Resolve a toolset name to all individual tool names.
 * Handles composed toolsets recursively.
 */
export function resolveToolset(name: string): string[] {
  const toolset = TOOLSETS[name];
  if (!toolset) return [];

  const resolved = new Set<string>();
  for (const item of toolset) {
    if (TOOLSETS[item]) {
      // It's a composed toolset — resolve recursively
      for (const tool of resolveToolset(item)) {
        resolved.add(tool);
      }
    } else {
      resolved.add(item);
    }
  }
  return Array.from(resolved);
}

/**
 * Get all available toolset names.
 */
export function getAvailableToolsets(): string[] {
  return Object.keys(TOOLSETS);
}

/**
 * Check if a tool belongs to a toolset.
 */
export function isToolInToolset(toolName: string, toolsetName: string): boolean {
  const tools = resolveToolset(toolsetName);
  return tools.includes(toolName);
}

/**
 * Get the toolset(s) a tool belongs to.
 */
export function getToolsetsForTool(toolName: string): string[] {
  const result: string[] = [];
  for (const [name, tools] of Object.entries(TOOLSETS)) {
    if (tools.includes(toolName)) result.push(name);
  }
  return result;
}

/**
 * Get tool names for a toolset (alias for getToolset with composed expansion).
 */
export function getToolsetTools(name: string): string[] {
  return resolveToolset(name);
}

/**
 * List all toolsets as Toolset objects.
 */
export function listToolsets(): Toolset[] {
  return Object.entries(TOOLSETS).map(([name, tools]) => ({
    name,
    tools: [...tools],
    description: TOOLSET_DESCRIPTIONS[name],
  }));
}

const TOOLSET_DESCRIPTIONS: Record<string, string> = {
  file: 'File operations (read, write, edit, search, glob)',
  exec: 'Terminal execution (terminal, bash)',
  web: 'Web research (search, fetch, browser)',
  git: 'Git operations',
  memory: 'Memory and context (memory, todo, session search)',
  planning: 'Planning and skills',
  tasks: 'Task management (create, list, get, update, output, stop)',
  review: 'Code review (artifact review, PR suggestions)',
  agent: 'Agent delegation and clarification',
  coding: 'Full coding workflow (file + exec + git + memory + planning)',
  research: 'Research workflow (web + memory)',
  full: 'Everything (all tools)',
};
