import type { ContentBlock } from '../providers/types.js';
import { highlightLine } from './syntax.js';

export interface Component {
  render(width: number): string[];
  handleInput?(char: string): void;
  focused?: boolean;
  children?: Component[];
}

interface BoxOptions {
  title?: string;
  borderColor?: string;
  titleColor?: string;
  paddingX?: number;
  paddingY?: number;
  width?: number;
}

export class FrameComponent implements Component {
  children: Component[] = [];

  constructor(children: Component[] = []) {
    this.children = children;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      lines.push(...child.render(width));
    }
    return lines;
  }
}

export class BoxComponent implements Component {
  children: Component[] = [];
  private label: string;
  private borderColor: string;
  private titleColor: string;
  private padX: number;
  private padY: number;
  private fixedWidth: number | null;

  constructor(children: Component[] = [], opts: BoxOptions = {}) {
    this.children = children;
    this.label = opts.title || '';
    this.borderColor = opts.borderColor || '\x1b[38;2;60;60;68m';
    this.titleColor = opts.titleColor || '\x1b[38;2;153;153;153m';
    this.padX = opts.paddingX ?? 1;
    this.padY = opts.paddingY ?? 0;
    this.fixedWidth = opts.width || null;
  }

  render(width: number): string[] {
    const w = this.fixedWidth || width;
    const R = '\x1b[0m';
    const lines: string[] = [];
    const bordered = this.label.length > 0;

    const innerWidth = bordered ? w - 2 - this.padX * 2 : w;

    const childLines: string[] = [];
    for (const child of this.children) {
      childLines.push(...child.render(innerWidth));
    }

    if (!bordered) {
      return childLines;
    }

    lines.push(`${this.borderColor}╭${R} ${this.titleColor}${this.label}${R} ${this.borderColor}${'─'.repeat(Math.max(0, w - this.label.length - 4))}╮${R}`);

    for (const line of childLines) {
      const pv = Math.max(0, w - 2 - this.padX * 2 - visibleLength(line));
      lines.push(`${this.borderColor}│${R}${' '.repeat(this.padX)}${line}${' '.repeat(pv)}${' '.repeat(this.padX)}${this.borderColor}│${R}`);
    }

    lines.push(`${this.borderColor}╰${'─'.repeat(w - 2)}╯${R}`);
    return lines;
  }
}

export class TextComponent implements Component {
  children: Component[] = [];

  constructor(private content: string) {}

  render(width: number): string[] {
    return this.content.split('\n');
  }

  setText(text: string): void {
    this.content = text;
  }
}

export class ThinkingComponent implements Component {
  children: Component[] = [];

  private static SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private static FACES = [
    '(｡◕‿◕｡)', '(◕‿◕✿)', '٩(◕‿◕｡)۶', '(✿◠‿◠)', '( ˘▽˘)っ',
    '♪(´ε` )', '(◕ᴗ◕✿)', 'ヾ(＾∇＾)', '(≧◡≦)', '(★ω★)',
    '(｡•́︿•̀｡)', '(◔_◔)', '(¬‿¬)', '( •_•)>⌐■-■', '(⌐■_■)',
    '(´･_･`)', '◉_◉', '(°ロ°)', '( ˘⌣˘)♡', 'ヽ(>∀<☆)☆',
    '٩(๑❛ᴗ❛๑)۶', '(⊙_⊙)', '(¬_¬)', '( ͡° ͜ʖ ͡°)', 'ಠ_ಠ',
  ];
  private static VERBS = [
    'pondering', 'contemplating', 'musing', 'cogitating', 'ruminating',
    'deliberating', 'mulling', 'reflecting', 'processing', 'reasoning',
    'analyzing', 'computing', 'synthesizing', 'formulating', 'brainstorming',
    'reticulating', 'transmuting', 'weaving', 'scrying', 'channeling',
  ];

  private active = false;
  private startTime = 0;
  private thoughts: string[] = [];
  private frameCounter = 0;
  private lastRenderedFrame = -1;

  start(initialThought?: string): void {
    this.active = true;
    this.startTime = Date.now();
    this.thoughts = [];
    this.frameCounter = 0;
    this.lastRenderedFrame = -1;
    if (initialThought) this.thoughts.push(initialThought);
  }

  stop(): string[] {
    this.active = false;
    this.frameCounter = 0;
    return this.thoughts;
  }

  tick(): void {
    if (this.active) this.frameCounter++;
  }

  isActive(): boolean {
    return this.active;
  }

  addThought(text: string): void {
    if (text.trim()) {
      this.thoughts.push(text.trim());
    }
  }

  render(width: number): string[] {
    if (!this.active) return [];

    const R = '\x1b[0m', D = '\x1b[2m', B = '\x1b[1m';
    const pr = '\x1b[38;2;0;204;204m';
    const mu = '\x1b[38;2;153;153;153m';
    const se = '\x1b[38;2;177;185;249m';

    const elapsed = Date.now() - this.startTime;
    const lines: string[] = [];

    // Use frame counter for animation (ticked externally), not raw elapsed
    const animFrame = this.frameCounter;
    const frameIdx = animFrame % ThinkingComponent.SPINNER.length;
    const faceIdx = Math.floor(animFrame / 25) % ThinkingComponent.FACES.length;
    const verbIdx = Math.floor(animFrame / 37) % ThinkingComponent.VERBS.length;

    const spinner = ThinkingComponent.SPINNER[frameIdx];
    const face = ThinkingComponent.FACES[faceIdx];
    const verb = ThinkingComponent.VERBS[verbIdx];
    const elapsedStr = elapsed >= 1000
      ? `${(elapsed / 1000).toFixed(1)}s`
      : `${elapsed}ms`;

    lines.push(`  ${pr}${spinner}${R} ${D}${mu}${verb}${R} ${mu}·${R} ${D}${mu}${elapsedStr}${R} ${D}${se}${face}${R}`);

    const shown = this.thoughts.slice(-3);
    for (const t of shown) {
      const mw = Math.max(10, width - 14);
      const line = t.replace(/\n/g, ' ').length > mw
        ? t.replace(/\n/g, ' ').slice(0, mw - 1) + '…'
        : t.replace(/\n/g, ' ');
      if (line.trim()) {
        lines.push(`  ${D}${mu}┊${R} ${D}${se}${line}${R}`);
      }
    }

    return lines;
  }
}

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export class ChatComponent implements Component {
  children: Component[] = [];
  private messages: ChatMessage[] = [];
  private toolCalls: ToolCallState[] = [];

  constructor() {}

  setMessages(msgs: ChatMessage[]): void {
    this.messages = msgs;
  }

  setToolCalls(calls: ToolCallState[]): void {
    this.toolCalls = calls;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  getToolCalls(): ToolCallState[] {
    return this.toolCalls;
  }

  private formatCodeBlock(code: string, lang: string, width: number): string[] {
    const R = '\x1b[0m', D = '\x1b[2m';
    const pr = '\x1b[38;2;0;204;204m';
    const mu = '\x1b[38;2;153;153;153m';
    const lines: string[] = [];

    const headerLang = lang || 'code';
    const header = `  ${pr}╭─ ${headerLang} ${'─'.repeat(Math.max(2, width - headerLang.length - 10))}${R}`;
    const footer = `  ${pr}╰${'─'.repeat(Math.max(2, width - 4))}${R}`;
    lines.push(header);

    const codeLines = code.split('\n');
    for (const line of codeLines) {
      const hl = highlightLine(line, lang);
      lines.push(`  ${mu}│${R} ${hl}`);
    }

    lines.push(footer);
    return lines;
  }

  render(width: number): string[] {
    const R = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m';
    const c = {
      primary: '\x1b[38;2;0;204;204m',
      accent: '\x1b[38;2;215;119;87m',
      muted: '\x1b[38;2;153;153;153m',
      subtle: '\x1b[38;2;80;80;80m',
      text: '\x1b[38;2;230;230;230m',
      user: '\x1b[38;2;180;180;190m',
      success: '\x1b[38;2;78;186;101m',
      error: '\x1b[38;2;255;107;128m',
      warning: '\x1b[38;2;255;193;7m',
    };
    const lines: string[] = [];

    const now = this.messages.length > 2 ? `${this.messages.length} msgs` : '';

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (msg.role === 'system') continue;
      const content = typeof msg.content === 'string' ? msg.content : '';

      if (msg.role === 'user') {
        lines.push(`  ${B}${c.primary}You${R}${now ? ` ${D}${c.muted}${now}${R}` : ''}`);
        for (const line of content.split('\n')) {
          const visibleL = line.replace(/\x1b\[[0-9;]*m/g, '').length;
          lines.push(`  ${' '.repeat(3)}${line}${' '.repeat(Math.max(0, width - visibleL - 5))}`);
        }
        if (i < this.messages.length - 1) lines.push('');
      } else if (msg.role === 'assistant') {
        const label = 'Kairo';
        lines.push(`  ${B}${c.primary}${label}${R}${now ? ` ${D}${c.muted}${now}${R}` : ''}`);

        // Split content into code blocks and text, render with highlighting
        const parts = content.split(/(```[\s\S]*?```)/g);
        for (const part of parts) {
          const match = part.match(/^```(\w*)\n([\s\S]*?)```$/);
          if (match) {
            const lang = match[1] || '';
            const code = match[2].trimEnd();
            lines.push(...this.formatCodeBlock(code, lang, width));
          } else {
            for (const line of part.split('\n')) {
              const visibleL = line.replace(/\x1b\[[0-9;]*m/g, '').length;
              lines.push(`  ${' '.repeat(3)}${line}${' '.repeat(Math.max(0, width - visibleL - 5))}`);
            }
          }
        }

        if (i < this.messages.length - 1) lines.push('');
      }
    }

    for (const tool of this.toolCalls) {
      const statusIcon = tool.status === 'running' ? `${c.warning}●${R}` : tool.status === 'success' ? `${c.success}✓${R}` : `${c.error}✗${R}`;
      const sep = `${c.muted}┊${R}`;
      const timing = tool.durationMs ? ` ${D}${c.muted}(${tool.durationMs < 1000 ? Math.round(tool.durationMs) + 'ms' : (tool.durationMs / 1000).toFixed(1) + 's'})${R}` : '';
      // Flatten JSON args for display so the user sees the actual query/command
      // instead of raw JSON like {"query":"now"}.
      let argsPreview = tool.args?.slice(0, 60) || '';
      if (argsPreview.trim().startsWith('{')) {
        try {
          // Simple extraction: try to pull out the first string value.
          const match = argsPreview.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
          if (match) {
            argsPreview = `${match[1]}="${match[2]}"`;
          }
        } catch {
          // Keep raw on parse failure.
        }
      }
      lines.push(`  ${statusIcon} ${sep} ${B}${c.accent}${tool.name}${R}${timing} ${D}${argsPreview}${R}`);
      if (tool.result && tool.status === 'success') {
        // Show more of the result — 200 chars instead of 80.
        const preview = tool.result.slice(0, 200).replace(/\n/g, ' ');
        lines.push(`    ${sep} ${D}${preview}${R}`);
      }
      if (tool.result && tool.status === 'error') {
        const preview = tool.result.slice(0, 200).replace(/\n/g, ' ');
        lines.push(`    ${sep} ${c.error}${preview}${R}`);
      }
    }

    return lines;
  }
}

export interface ToolCallState {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'success' | 'error';
  result?: string;
  startTime?: number;
  durationMs?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
}

export class InputComponent implements Component {
  children: Component[] = [];
  private buffer: string = '';
  private cursor: number = 0;
  private placeholder: string = '';
  private disabled: boolean = false;
  private onSubmit: ((val: string) => void) | null = null;
  private onBufferChange: ((val: string) => void) | null = null;

  constructor() {
    this.buffer = '';
  }

  setDisabled(d: boolean): void {
    this.disabled = d;
  }

  setBuffer(val: string): void {
    this.buffer = val;
    this.cursor = val.length;
  }

  setOptions(opts: { placeholder?: string; onSubmit?: (val: string) => void; onBufferChange?: (val: string) => void }): void {
    if (opts.placeholder !== undefined) this.placeholder = opts.placeholder;
    if (opts.onSubmit !== undefined) this.onSubmit = opts.onSubmit;
    if (opts.onBufferChange !== undefined) this.onBufferChange = opts.onBufferChange;
  }

  handleInput(char: string): void {
    if (this.disabled) return;

    if (char === '\r' || char === '\n') {
      const val = this.buffer.trim();
      if (val && this.onSubmit) {
        this.onSubmit(val);
      }
      return;
    }

    if (char === '\x7f' || char === '\b') {
      if (this.cursor > 0) {
        this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
        this.cursor--;
      }
      this.onBufferChange?.(this.buffer);
      return;
    }

    if (char === '\x1b[D') {
      if (this.cursor > 0) this.cursor--;
      return;
    }
    if (char === '\x1b[C') {
      if (this.cursor < this.buffer.length) this.cursor++;
      return;
    }
    if (char === '\x1b[H') { this.cursor = 0; return; }
    if (char === '\x1b[F') { this.cursor = this.buffer.length; return; }

    if (char.length === 1 && char.charCodeAt(0) >= 32) {
      this.buffer = this.buffer.slice(0, this.cursor) + char + this.buffer.slice(this.cursor);
      this.cursor++;
      this.onBufferChange?.(this.buffer);
    }
  }

  render(width: number): string[] {
    const R = '\x1b[0m', D = '\x1b[2m', B = '\x1b[1m';
    const c = {
      primary: '\x1b[38;2;0;204;204m',
      muted: '\x1b[38;2;153;153;153m',
      border: '\x1b[38;2;80;80;88m',
      subtle: '\x1b[38;2;60;60;68m',
    };

    const innerW = width - 6;
    const displayText = this.buffer.length > 0 ? this.buffer : (this.placeholder ? `${D}${c.muted}${this.placeholder}${R}` : '');
    const truncated = displayText.length > innerW ? '…' + displayText.slice(-(innerW - 1)) : displayText;
    const truncatedNoAnsi = truncated.replace(/\x1b\[[0-9;]*m/g, '');
    const visibleLen = this.buffer ? this.buffer.length : 0;

    const topBorder = `${c.border}╭${'─'.repeat(width - 2)}╮${R}`;
    const bottomBorder = `${c.border}╰${'─'.repeat(width - 2)}╯${R}`;

    const promptChar = this.disabled ? `${c.muted}○${R}` : `${c.primary}${B}❯${R}`;
    const padRight = Math.max(0, width - 4 - visibleLen);
    const inputLine = `${c.border}│${R} ${promptChar} ${truncated}${' '.repeat(padRight + 2)}${this.disabled ? `${D}⏳${R}` : ''}${c.border}│${R}`;

    return [topBorder, inputLine, bottomBorder];
  }
}

export class StatusBarComponent implements Component {
  children: Component[] = [];
  private modelInfo: string = '';
  private contextUsage: string = '';
  private leftText: string = '';
  private rightText: string = '';
  private activeTools: Array<{ name: string; status: 'running' | 'success' | 'error' }> = [];
  private turnCount: number = 0;
  private streaming: boolean = false;
  // Subagent tracking fields
  private activeAgentCount: number = 0;
  private agentSparkline: string = '';
  private agentRole: string = '';
  private agentModel: string = '';
  private turnToolCalls: number = 0;
  private turnElapsed: string = '';

  constructor() {}

  setModelInfo(info: string): void {
    this.modelInfo = info;
  }

  setContextUsage(usage: string): void {
    this.contextUsage = usage;
  }

  setLeftText(text: string): void {
    this.leftText = text;
  }

  setRightText(text: string): void {
    this.rightText = text;
  }

  setActiveTools(tools: Array<{ name: string; status: 'running' | 'success' | 'error' }>): void {
    this.activeTools = tools;
  }

  setTurnCount(count: number): void {
    this.turnCount = count;
  }

  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
  }

  setActiveAgentCount(count: number): void {
    this.activeAgentCount = count;
  }

  setAgentSparkline(sparkline: string): void {
    this.agentSparkline = sparkline;
  }

  setAgentRole(role: string): void {
    this.agentRole = role;
  }

  setAgentModel(model: string): void {
    this.agentModel = model;
  }

  setTurnToolCalls(count: number): void {
    this.turnToolCalls = count;
  }

  setTurnElapsed(elapsed: string): void {
    this.turnElapsed = elapsed;
  }

  render(width: number): string[] {
    const R = '\x1b[0m', D = '\x1b[2m', B = '\x1b[1m';
    const c = {
      primary: '\x1b[38;2;0;204;204m',
      muted: '\x1b[38;2;153;153;153m',
      subtle: '\x1b[38;2;60;60;68m',
      success: '\x1b[38;2;78;186;101m',
      warning: '\x1b[38;2;255;193;7m',
      error: '\x1b[38;2;255;107;128m',
      accent: '\x1b[38;2;215;119;87m',
    };

    const separator = `${c.subtle}${'─'.repeat(width)}${R}`;

    // Build left side: status + model + turn count
    const leftParts: string[] = [];
    if (this.streaming) {
      leftParts.push(`${c.primary}${B}● streaming${R}`);
    } else if (this.leftText) {
      leftParts.push(this.leftText);
    } else {
      leftParts.push(`${c.success}● ready${R}`);
    }
    if (this.agentRole && this.agentModel) {
      leftParts.push(`${c.accent}${this.agentRole}${R} ${D}${c.muted}${this.agentModel}${R}`);
    } else if (this.modelInfo) {
      leftParts.push(`${D}${c.muted}${this.modelInfo}${R}`);
    }
    if (this.turnCount > 0) leftParts.push(`${D}turn ${this.turnCount}${R}`);

    // Build right side: active tools + context
    const rightParts: string[] = [];
    if (this.activeAgentCount > 0) {
      rightParts.push(`${c.accent}${this.activeAgentCount} agents ●${R}`);
    }
    if (this.agentSparkline) {
      rightParts.push(`${c.primary}${this.agentSparkline}${R}`);
    }
    if (this.turnToolCalls > 0) {
      rightParts.push(`${c.muted}${this.turnToolCalls} tools${R}`);
    }
    if (this.turnElapsed) {
      rightParts.push(`${D}${this.turnElapsed}${R}`);
    }
    if (this.activeTools.length > 0) {
      const toolStr = this.activeTools.map(t => {
        const icon = t.status === 'running' ? `${c.warning}⟳${R}` : t.status === 'success' ? `${c.success}✓${R}` : `${c.error}✗${R}`;
        return `${icon}${t.name}`;
      }).join(' ');
      rightParts.push(toolStr);
    }
    if (this.contextUsage) rightParts.push(`${c.success}${this.contextUsage}${R}`);
    if (this.rightText) rightParts.push(this.rightText);

    const left = leftParts.join(` ${c.muted}·${R} `);
    const right = rightParts.join(' ');

    if (right) {
      const leftVisible = left.replace(/\x1b\[[0-9;]*m/g, '');
      const rightVisible = right.replace(/\x1b\[[0-9;]*m/g, '');
      const padding = Math.max(1, width - leftVisible.length - rightVisible.length - 4);
      return [separator, `  ${D}${left}${' '.repeat(padding)}${right}${R}`];
    }

    return [separator, `  ${left ? `${D}${left}${R}` : `${D}${c.muted}Ready.${R}`}`];
  }
}

function sideBySide(left: string[], right: string[], gap: number = 2): string[] {
  const max = Math.max(left.length, right.length);
  const lw = Math.max(0, ...left.map(l => visibleLength(l)));
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const l = i < left.length ? left[i] : '';
    const r = i < right.length ? right[i] : '';
    const lv = visibleLength(l);
    out.push(l + ' '.repeat(lw - lv + gap) + r);
  }
  return out;
}

function cuteMascot(): string[] {
  const p = '\x1b[38;2;0;204;204m';
  const g = '\x1b[38;2;90;170;200m';
  const b = '\x1b[38;2;140;120;200m';
  const s = '\x1b[38;2;177;185;249m';
  const m = '\x1b[38;2;153;153;153m';
  const R = '\x1b[0m';
  const D = '\x1b[2m';
  const o = '\x1b[38;2;215;119;87m';
  return [
    `${g}╭${p}⊙${g}${'━'.repeat(12)}${p}⊙${g}╮${R}`,
    `${g}┃${p}◉${R}  ${g}╭${b}${'━'.repeat(6)}${g}╮${R}  ${p}◉${g}┃${R}`,
    `${g}┃${R}   ${g}┃${p}◉${R}${' '.repeat(4)}${p}◉${g}┃${R}   ${g}┃${R}`,
    `${g}┃${R}   ${g}┃${R}${' '.repeat(3)}${b}◇${R}${' '.repeat(2)}${g}┃${R}   ${g}┃${R}`,
    `${g}┃${R}   ${g}╰${b}${'━'.repeat(6)}${g}╯${R}   ${g}┃${R}`,
    `${g}╰${'━'.repeat(14)}╯${R}`,
  ];
}

function compactTipsBox(): string[] {
  const b = '\x1b[38;2;60;60;68m';
  const p = '\x1b[38;2;0;204;204m';
  const R = '\x1b[0m';
  const D = '\x1b[2m';
  const items = [
    `${p}/help${R}  ${p}/clear${R}`,
    `${p}/model${R} ${p}/plan${R}`,
    `${D}!read${R}  ${D}!exec${R}`,
    `${D}Ctrl+C${R}  ${D}Tab↑↓${R}`,
  ];
  const iw = Math.max(...items.map(l => visibleLength(l)));
  const w = Math.min(iw + 4, 24);
  const top = `${b}╭${D} Tips ${b}${'─'.repeat(Math.max(0, w - 7))}╮${R}`;
  const bot = `${b}╰${'─'.repeat(Math.max(0, w - 2))}╯${R}`;
  const out: string[] = [top];
  for (const item of items) {
    const pad = w - 2 - visibleLength(item) - 2;
    out.push(`${b}│${R}  ${item}${' '.repeat(Math.max(0, pad))}${b}│${R}`);
  }
  out.push(bot);
  return out;
}

export function kairoBrand(): string[] {
  const g1 = '\x1b[38;2;0;220;220m';
  const g2 = '\x1b[38;2;0;190;210m';
  const g3 = '\x1b[38;2;50;150;200m';
  const g4 = '\x1b[38;2;110;120;210m';
  const g5 = '\x1b[38;2;160;90;200m';
  const g6 = '\x1b[38;2;200;70;180m';
  const se = '\x1b[38;2;177;185;249m';
  const R = '\x1b[0m';
  const B = '\x1b[1m';
  const D = '\x1b[2m';
  const mu = '\x1b[38;2;153;153;153m';

  const logo: string[] = [
    `${B}${g1}    ██╗  ██╗ █████╗ ██╗██████╗  ██████╗${R}`,
    `${B}${g2}    ██║ ██╔╝██╔══██╗██║██╔══██╗██╔═══██╗${R}`,
    `${B}${g3}    █████╔╝ ███████║██║██████╔╝██║   ██║${R}`,
    `${B}${g4}    ██╔═██╗ ██╔══██║██║██╔══██╗██║   ██║${R}`,
    `${B}${g5}    ██║  ██╗██║  ██║██║██║  ██║╚██████╔╝${R}`,
    `${B}${g6}    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝${R}`,
  ];

  const mascot = cuteMascot();
  const tips = compactTipsBox();
  const row = sideBySide(mascot, tips);
  const main = sideBySide(logo, row, 3);

  const tagline = `  ${se}${B}✦${R} ${B}${se}(◕‿◕)${R} ${B}${se}KAIRO${R} ${D}${se}Ready${R} ${mu}·${R} ${D}${se}The Cycle Path · by Subhansh${R} ${se}${B}✦${R}`;

  return [...main, '', tagline, ''];
}

export function modelInfoBlock(model: string, provider: string, contextPct: number = 0): string[] {
  const c = {
    primary: '\x1b[38;2;0;204;204m',
    muted: '\x1b[38;2;153;153;153m',
    success: '\x1b[38;2;78;186;101m',
    subtle: '\x1b[38;2;60;60;68m',
    warning: '\x1b[38;2;255;193;7m',
  };
  const R = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m';

  const barLen = 20;
  const filled = Math.round((contextPct / 100) * barLen);
  const empty = barLen - filled;
  const barColor = contextPct > 80 ? c.warning : c.success;
  const bar = `${barColor}${'█'.repeat(filled)}${R}${c.subtle}${'░'.repeat(empty)}${R}`;

  return [
    `  ${c.primary}${B}●${R} ${B}${model}${R} ${D}·${R} ${c.primary}${provider}${R} ${bar} ${D}${contextPct}%${R}`,
  ];
}

export function tips(extra: string[] = []): string[] {
  const tips = [
    '/help for commands',
    '!tool to use tools',
    'Ctrl+C to exit',
    '/model to switch',
    '/clear to reset',
    '/skills to list skills',
    '/plan for plan mode',
    '/stats for cost tracker',
    '/agents to run agents',
    '/session to see status',
  ];
  const all = [...tips, ...extra];
  const r = all[Math.floor(Math.random() * all.length)];
  const cc = '\x1b[38;2;153;153;153m';
  const R = '\x1b[0m';
  const D = '\x1b[2m';
  return [`  ${D}${cc}Tip: ${r}${R}`];
}

export function planModeIndicator(active: boolean, steps: number = 0, approved: boolean = false): string[] {
  const c = {
    warning: '\x1b[38;2;255;193;7m',
    success: '\x1b[38;2;78;186;101m',
    primary: '\x1b[38;2;0;204;204m',
    muted: '\x1b[38;2;153;153;153m',
  };
  const R = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m';
  if (!active) return [];
  const status = approved ? `${c.success}${B}✔${R}` : `${c.warning}${B}◐${R}`;
  return [
    `  ${status} ${B}${c.primary}PLAN MODE${R}${steps > 0 ? ` ${D}(${steps} steps)${R}` : ''}`,
  ];
}

export function keyPoolStatus(poolStatus: Record<string, { total: number; available: number; cooldown: number }>): string[] {
  const c = {
    primary: '\x1b[38;2;0;204;204m',
    success: '\x1b[38;2;78;186;101m',
    muted: '\x1b[38;2;153;153;153m',
    warning: '\x1b[38;2;255;193;7m',
    error: '\x1b[38;2;255;107;128m',
  };
  const R = '\x1b[0m', D = '\x1b[2m';
  const parts: string[] = [];
  for (const [provider, status] of Object.entries(poolStatus)) {
    const icon = status.available === status.total ? `${c.success}${status.total}K${R}` :
      status.available > 0 ? `${c.warning}${status.available}/${status.total}K${R}` :
        `${c.error}0/${status.total}K${R}`;
    parts.push(`${c.primary}${provider}${R}:${icon}`);
  }
  if (parts.length === 0) return [];
  return [`  ${D}Keys: ${parts.join(' ')}${R}`];
}
