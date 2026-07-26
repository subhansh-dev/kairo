/**
 * Kairo — Personality Engine
 * Generates conversational, contextual messages for tool calls and status updates.
 * Makes the TUI feel alive between tool calls — like Claude Code's vibe.
 */

// ─── ANSI Helpers ───────────────────────────────────────────────

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const CYAN = '\x1b[38;2;0;204;204m';
const ORANGE = '\x1b[38;2;215;119;87m';
const PURPLE = '\x1b[38;2;177;185;249m';
const GREEN = '\x1b[38;2;78;186;101m';
const YELLOW = '\x1b[38;2;255;193;7m';
const RED = '\x1b[38;2;255;107;128m';
const MUTED = '\x1b[38;2;153;153;153m';

// ─── Tool Action Phrases ────────────────────────────────────────
// Casual phrases for when a tool starts executing

const TOOL_START_PHRASES: Record<string, string[]> = {
  read: [
    'Lemme grab that file',
    'On it, reading now',
    'Pulling up the code',
    'Let me check that out',
    'Reading through it',
  ],
  write: [
    'Writing that up',
    'On it, putting it down',
    'Gotchu, writing now',
    'Locking in the code',
    'Writing it out',
  ],
  edit: [
    'Tweaking that for you',
    'Making the edit',
    'On it, patching now',
    'Fixing that up',
    'Applying the change',
  ],
  exec: [
    'Running it',
    'Let\'s see what happens',
    'Firing it off',
    'Executing',
    'Sending it',
  ],
  grep: [
    'Searching through the codebase',
    'Hunting for it',
    'Grepping for that',
    'Let me find that',
    'Searching...',
  ],
  glob: [
    'Finding files',
    'Looking for matches',
    'Scanning for files',
    'Hunting down files',
  ],
  ls: [
    'Checking what\'s there',
    'Listing it out',
    'Looking around',
    'Peeking at the directory',
  ],
  git: [
    'Checking git',
    'Let me look at the repo',
    'Git magic',
    'Checking the history',
  ],
  web_fetch: [
    'Grabbing that page',
    'Fetching it',
    'Let me pull that up',
    'On it, downloading',
  ],
  web_search: [
    'Searching the web',
    'Looking that up',
    'Let me google that',
    'Finding info',
  ],
  think: [
    'Thinking through this',
    'Let me reason about this',
    'Processing...',
    'Working through it',
  ],
};

// ─── Tool Success Phrases ───────────────────────────────────────
// Casual phrases for when a tool completes successfully

const TOOL_SUCCESS_PHRASES: Record<string, string[]> = {
  read: [
    'Got it',
    'There we go',
    'Found it',
    'Yep, got the file',
    'Cool, got the code',
  ],
  write: [
    'Done, file written',
    'Written ✨',
    'Got it down',
    'File saved',
    'Locked in',
  ],
  edit: [
    'Edit applied',
    'Fixed up',
    'Patched ✨',
    'Done, change applied',
    'Updated',
  ],
  exec: [
    'Ran clean',
    'Done',
    'All good',
    'Command finished',
    'Executed',
  ],
  grep: [
    'Found some hits',
    'Got matches',
    'There are results',
    'Found it',
  ],
  glob: [
    'Found the files',
    'Got matches',
    'Files found',
  ],
  ls: [
    'Here\'s what\'s there',
    'Got the listing',
    'There we go',
  ],
  git: [
    'Git info loaded',
    'Got the repo state',
    'There we go',
  ],
  web_fetch: [
    'Got the page',
    'Fetched it',
    'Page loaded',
  ],
  web_search: [
    'Found some results',
    'Search done',
    'Got hits',
  ],
};

// ─── Thinking Phrases ───────────────────────────────────────────
// What to show when the model is thinking between tool calls

const THINKING_PHRASES = [
  'Processing what I found',
  'Looking at the results',
  'Thinking about next steps',
  'Analyzing the output',
  'Figuring out the best approach',
  'Reasoning through this',
  'Connecting the dots',
  'Piecing it together',
  'Working through the logic',
  'Planning the next move',
];

// ─── Multi-Tool Summary Phrases ─────────────────────────────────

const MULTI_TOOL_INTROS = [
  'Called',
  'Used',
  'Ran',
  'Executed',
];

// ─── Personality State ──────────────────────────────────────────

let phraseUsageCount: Record<string, number> = {};

function pickPhrase(pool: string[], key: string): string {
  // Track usage to avoid repeating same phrase
  const count = phraseUsageCount[key] || 0;
  phraseUsageCount[key] = count + 1;
  return pool[count % pool.length];
}

/**
 * Reset personality state (for new sessions).
 */
export function resetPersonality(): void {
  phraseUsageCount = {};
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Get a casual phrase for when a tool starts executing.
 * Returns formatted string with tool name and emoji.
 */
export function getToolStartMessage(toolName: string, args?: string): string {
  const phrases = TOOL_START_PHRASES[toolName] || [`Running ${toolName}`];
  const phrase = pickPhrase(phrases, `start_${toolName}`);
  
  // Add a brief arg preview for context
  let argPreview = '';
  if (args) {
    const short = args.length > 50 ? args.slice(0, 50) + '…' : args;
    argPreview = ` ${D}${MUTED}${short}${R}`;
  }

  return `${CYAN}${B}●${R} ${phrase}${argPreview}`;
}

/**
 * Get a casual phrase for when a tool completes successfully.
 * Returns formatted string with timing.
 */
export function getToolSuccessMessage(toolName: string, durationMs?: number): string {
  const phrases = TOOL_SUCCESS_PHRASES[toolName] || ['Done'];
  const phrase = pickPhrase(phrases, `success_${toolName}`);
  
  const timing = durationMs ? ` ${D}${MUTED}(${formatDuration(durationMs)})${R}` : '';
  return `${GREEN}✓${R} ${phrase}${timing}`;
}

/**
 * Get a phrase for when a tool fails.
 */
export function getToolErrorMessage(toolName: string, error?: string): string {
  const preview = error ? `: ${error.slice(0, 60)}` : '';
  return `${RED}✗${R} ${toolName} failed${D}${MUTED}${preview}${R}`;
}

/**
 * Get a thinking phrase for between tool calls.
 */
export function getThinkingMessage(): string {
  return pickPhrase(THINKING_PHRASES, 'thinking');
}

/**
 * Format a multi-tool summary line.
 * Like "Called composio 2 times (ctrl+o to expand)"
 */
export function formatToolCallSummary(
  toolCalls: Array<{ name: string; status: string; durationMs?: number }>,
): string {
  if (toolCalls.length === 0) return '';

  // Group by tool name
  const groups = new Map<string, { count: number; statuses: string[]; totalDuration: number }>();
  for (const tc of toolCalls) {
    const existing = groups.get(tc.name) || { count: 0, statuses: [], totalDuration: 0 };
    existing.count++;
    existing.statuses.push(tc.status);
    existing.totalDuration += tc.durationMs || 0;
    groups.set(tc.name, existing);
  }

  const intro = pickPhrase(MULTI_TOOL_INTROS, 'multi_intro');
  const parts: string[] = [];

  for (const [name, info] of groups) {
    const allSuccess = info.statuses.every(s => s === 'success');
    const anyError = info.statuses.some(s => s === 'error');
    const statusIcon = anyError ? `${RED}✗${R}` : allSuccess ? `${GREEN}✓${R}` : `${YELLOW}●${R}`;

    if (info.count > 1) {
      const timing = info.totalDuration > 0 ? ` ${D}${MUTED}(${formatDuration(info.totalDuration)})${R}` : '';
      parts.push(`${statusIcon} ${name} ${D}${MUTED}×${info.count}${R}${timing}`);
    } else {
      const timing = info.totalDuration > 0 ? ` ${D}${MUTED}(${formatDuration(info.totalDuration)})${R}` : '';
      parts.push(`${statusIcon} ${name}${timing}`);
    }
  }

  return `${D}${MUTED}${intro}${R} ${parts.join(' ')}`;
}

/**
 * Format a "Thought for Xs" indicator.
 */
export function formatThinkingDuration(durationMs: number): string {
  const sec = durationMs / 1000;
  const timeStr = sec < 1 ? `${Math.round(durationMs)}ms` : `${sec.toFixed(1)}s`;
  return `${D}${PURPLE}Thought for ${timeStr}${R}`;
}

/**
 * Format a "Thinking for Xs, calling tool…" indicator.
 */
export function formatThinkingWithTool(durationMs: number, toolName: string): string {
  const sec = durationMs / 1000;
  const timeStr = sec < 1 ? `${Math.round(durationMs)}ms` : `${sec.toFixed(1)}s`;
  return `${D}${PURPLE}Thinking for ${timeStr}, calling ${CYAN}${toolName}${PURPLE}…${R}`;
}

/**
 * Format a conversational progress update between tool calls.
 * E.g., "Found your last 2 articles! Let me grab the full content."
 */
export function getProgressUpdate(
  completedTools: string[],
  nextTool?: string,
  context?: string,
): string {
  // Build a natural language summary of what just happened and what's next
  const lastTool = completedTools[completedTools.length - 1];
  
  if (nextTool) {
    const transitions: Record<string, Record<string, string>> = {
      read: {
        read: 'Let me check another file',
        write: 'Now let me write the changes',
        edit: 'Time to make the edit',
        exec: 'Let me run something',
        grep: 'Let me search for more',
      },
      grep: {
        read: 'Found it, let me read the file',
        write: 'Got what I need, writing now',
        edit: 'Found the spot, editing now',
        exec: 'Let me run a test',
        grep: 'Searching more broadly',
      },
      exec: {
        read: 'Let me check the output',
        write: 'Writing the fix',
        edit: 'Applying the patch',
        exec: 'Running another command',
      },
    };

    const transition = transitions[lastTool]?.[nextTool];
    if (transition) {
      return `${D}${PURPLE}${transition}${R}`;
    }
  }

  return '';
}

/**
 * Get a greeting-style message for the start of a task.
 */
export function getTaskGreeting(userInput: string): string {
  const lower = userInput.toLowerCase();
  
  if (lower.includes('fix') || lower.includes('bug')) {
    return `${CYAN}Ayy let me squash that bug${R} 🐛`;
  }
  if (lower.includes('read') || lower.includes('check') || lower.includes('look')) {
    return `${CYAN}Gotchu, let me check that out${R} 👀`;
  }
  if (lower.includes('write') || lower.includes('create') || lower.includes('add')) {
    return `${CYAN}On it, let me build that${R} 🔨`;
  }
  if (lower.includes('search') || lower.includes('find') || lower.includes('grep')) {
    return `${CYAN}Let me hunt that down${R} 🔍`;
  }
  if (lower.includes('test')) {
    return `${CYAN}Let me run those tests${R} 🧪`;
  }
  if (lower.includes('deploy') || lower.includes('ship')) {
    return `${CYAN}Let\'s ship it${R} 🚀`;
  }
  if (lower.includes('help') || lower.includes('how')) {
    return `${CYAN}Lemme help you out${R} 💡`;
  }
  
  const greetings = [
    `${CYAN}On it${R} 🔥`,
    `${CYAN}Let me get that${R} ⚡`,
    `${CYAN}Got it, working on it${R} ✨`,
    `${CYAN}Ayy let me handle that${R} 💪`,
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
}

// ─── Helpers ────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m${sec}s`;
}
