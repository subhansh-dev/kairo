/**
 * Tips — contextual tips for users.
 */

const TIPS = [
  'Use /help to see all available commands.',
  'Press Ctrl+C to interrupt the current operation.',
  'Use /model to switch between different AI models.',
  'Type /clear to start a fresh conversation.',
  'Use /stats to see token usage and costs.',
  'Skills are loaded from ~/.kairo/skills/ — add your own!',
  'Use /compact to compress context when it gets too large.',
  'The agent can run tools in parallel for faster results.',
  'Use /agents to see available specialized agents.',
  'Check /doctor if something seems wrong.',
  'Use /save to persist your current session.',
  'Type /tools to see all available tools.',
  'The agent learns from your feedback over time.',
  'Use /plan to enter planning mode before complex tasks.',
  'Subagents run in parallel — check /agents to see them.',
  'Use Ctrl+A to toggle the agent overlay panel.',
  'Context files (AGENTS.md, .cursorrules) are loaded automatically.',
  'The agent auto-detects your project type and adjusts behavior.',
  'Use /workflow to run multi-step agent pipelines.',
  'Memory files help the agent remember your preferences.',
];

let lastTipIndex = -1;

/**
 * Get a random tip (no repeats until all are shown).
 */
export function getRandomTip(): string {
  let index: number;
  do {
    index = Math.floor(Math.random() * TIPS.length);
  } while (index === lastTipIndex && TIPS.length > 1);

  lastTipIndex = index;
  return TIPS[index];
}

/**
 * Get a tip by index.
 */
export function getTip(index: number): string {
  return TIPS[index % TIPS.length];
}

/**
 * Get all tips.
 */
export function getAllTips(): string[] {
  return [...TIPS];
}

/**
 * Get the number of available tips.
 */
export function getTipCount(): number {
  return TIPS.length;
}
