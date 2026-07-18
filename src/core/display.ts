/**
 * Kairo — Display
 * CLI presentation — spinner, tool preview formatting.
 * Ported from Hermes Agent's display.py
 */

// ─── ANSI Colors ────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';

// ─── Spinner ────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private frame = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private message = '';

  start(message: string): void {
    this.message = message;
    this.frame = 0;
    this.interval = setInterval(() => {
      process.stderr.write(`\r${CYAN}${SPINNER_FRAMES[this.frame]}${RESET} ${this.message}`);
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
    }, 80);
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stderr.write('\r' + ' '.repeat(this.message.length + 10) + '\r');
    if (finalMessage) {
      process.stderr.write(finalMessage + '\n');
    }
  }

  update(message: string): void {
    this.message = message;
  }
}

// ─── Tool Preview ───────────────────────────────────────────────

export function formatToolCall(name: string, args: string): string {
  const preview = args.length > 80 ? args.slice(0, 80) + '…' : args;
  return `${CYAN}🔧 ${name}${RESET} ${DIM}${preview}${RESET}`;
}

export function formatToolResult(name: string, success: boolean, output: string, durationMs?: number): string {
  const icon = success ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
  const preview = output.length > 100 ? output.slice(0, 100) + '…' : output;
  const duration = durationMs ? ` ${DIM}(${durationMs}ms)${RESET}` : '';
  return `${icon} ${name}${duration}: ${preview}`;
}

export function formatThinking(content: string): string {
  return `${DIM}💭 ${content.slice(0, 200)}${RESET}`;
}

export function formatError(content: string): string {
  return `${RED}❌ ${content}${RESET}`;
}

export function formatSuccess(content: string): string {
  return `${GREEN}✅ ${content}${RESET}`;
}

export function formatRoute(provider: string, model: string): string {
  return `${BLUE}→ ${provider}/${model}${RESET}`;
}

export function formatProgress(current: number, total: number): string {
  const pct = Math.round((current / total) * 100);
  const barLen = 20;
  const filled = Math.round((current / total) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  return `${CYAN}${bar}${RESET} ${pct}% (${current}/${total})`;
}

// ─── Tool Emojis ────────────────────────────────────────────────

const TOOL_EMOJIS: Record<string, string> = {
  read: '📖',
  write: '✏️',
  edit: '🔧',
  exec: '⚡',
  grep: '🔍',
  glob: '📂',
  ls: '📁',
  git: '🔀',
  web_fetch: '🌐',
  web_search: '🔎',
  memory: '🧠',
  todo: '📝',
  think: '💭',
};

export function getToolEmoji(toolName: string): string {
  return TOOL_EMOJIS[toolName] || '🔧';
}

export function getToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    read: 'Reading',
    write: 'Writing',
    edit: 'Editing',
    exec: 'Running',
    grep: 'Searching',
    glob: 'Finding',
    ls: 'Listing',
    git: 'Git',
    web_fetch: 'Fetching',
    web_search: 'Searching web',
    memory: 'Memory',
    todo: 'Todo',
    think: 'Thinking',
  };
  return labels[toolName] || toolName;
}
