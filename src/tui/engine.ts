import type { Component } from './components.js';
import { ansiKeyToId } from './keybindings.js';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const ERASE_DISPLAY = '\x1b[2J';
const ERASE_LINE = '\x1b[2K';
const CURSOR_HOME = '\x1b[H';
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1003h';
const DISABLE_MOUSE = '\x1b[?1000l\x1b[?1002l\x1b[?1003l';

interface RenderCache {
  lines: readonly string[];
  width: number;
}

export type KeybindingHandler = (action: string) => void;

export class TUIEngine {
  private root: Component | null = null;
  private onTick: (() => void) | null = null;
  private width: number = 80;
  private height: number = 24;
  private cache: RenderCache | null = null;
  private focusIndex: number = 0;
  private focusable: Component[] = [];
  private running: boolean = false;
  private stdin: NodeJS.ReadStream;
  private stdout: NodeJS.WriteStream;
  private inputBuffer: string = '';
  private altScreenActive: boolean = false;
  private keybindingHandler: KeybindingHandler | null = null;
  private kbManager: import('./keybindings.js').KeybindingsManager | null = null;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderTime: number = 0;
  private minRenderInterval: number = 16; // ~60fps cap
  private dirty: boolean = true;
  private animating: boolean = false;
  private sigintHandler: (() => void) | null = null;
  private exitHandler: (() => void) | null = null;
  private sigwinchHandler: (() => void) | null = null;
  private dataHandler: ((data: Buffer) => void) | null = null;
  private globalInputHandler: ((char: string) => boolean) | null = null;
  private scrollOffset: number = 0;  // 0 = bottom (newest); >0 = scrolled up
  private allLines: readonly string[] = [];  // last rendered lines for scroll

  constructor(stdin: NodeJS.ReadStream = process.stdin, stdout: NodeJS.WriteStream = process.stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.width = stdout.columns || 80;
    this.height = stdout.rows || 24;
  }

  setRoot(component: Component): void {
    this.root = component;
    this.focusable = this.collectFocusable(component);
    this.cache = null;
  }

  setKeybindingHandler(handler: KeybindingHandler | null): void {
    this.keybindingHandler = handler;
  }

  setKeybindingManager(mgr: import('./keybindings.js').KeybindingsManager | null): void {
    this.kbManager = mgr;
  }

  setOnTick(handler: (() => void) | null): void {
    this.onTick = handler;
  }

  setGlobalInputHandler(handler: ((char: string) => boolean) | null): void {
    this.globalInputHandler = handler;
  }

  /** Scroll up by N lines (to see older output). */
  scrollUp(lines: number = 10): void {
    const maxScroll = Math.max(0, this.allLines.length - this.height + 1);
    this.scrollOffset = Math.min(this.scrollOffset + lines, maxScroll);
    this.cache = null;  // force full re-render
    this.requestRender();
  }

  /** Scroll down by N lines (toward newer output). */
  scrollDown(lines: number = 10): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
    if (this.scrollOffset === 0) {
      this.cache = null;
      this.requestRender();
    } else {
      this.cache = null;
      this.requestRender();
    }
  }

  /** Reset scroll to bottom (newest output). Only called by user action. */
  scrollToBottom(): void {
    if (this.scrollOffset > 0) {
      this.scrollOffset = 0;
      this.cache = null;
      this.requestRender();
    }
  }

  /** Auto-scroll to bottom only if user is already at the bottom.
   * Called when new content arrives. If the user has scrolled up to
   * read older output, don't yank them back to the bottom. */
  autoScrollIfAtBottom(): void {
    // If already at bottom, stay at bottom (new content flows naturally).
    // If scrolled up, do nothing — user is reading history.
    if (this.scrollOffset === 0) {
      // Already at bottom — no action needed, the render will show
      // the newest content automatically.
    }
  }

  /** Whether the user is currently scrolled up (not at the bottom). */
  isScrolledUp(): boolean {
    return this.scrollOffset > 0;
  }

  startAnimation(intervalMs: number = 80): void {
    if (this.animTimer) return;
    this.animating = true;
    this.animTimer = setInterval(() => {
      if (this.running && this.animating) {
        this.onTick?.();
        this.dirty = true;
        this.render();
      }
    }, intervalMs);
  }

  stopAnimation(): void {
    this.animating = false;
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    // Final render to show stopped state
    this.dirty = true;
    this.render();
  }

  private collectFocusable(component: Component): Component[] {
    const result: Component[] = [];
    if (typeof component.handleInput === 'function') {
      result.push(component);
    }
    if (component.children) {
      for (const child of component.children) {
        result.push(...this.collectFocusable(child));
      }
    }
    return result;
  }

  async start(useAltScreen: boolean = true, enableMouse: boolean = false): Promise<void> {
    this.running = true;
    if (useAltScreen) {
      this.stdout.write(ENTER_ALT_SCREEN);
      this.altScreenActive = true;
    }
    this.stdout.write(HIDE_CURSOR);
    if (enableMouse) {
      this.stdout.write(ENABLE_MOUSE);
    }
    this.enableRawMode();
    this.render();
    this.startInputLoop();
    this.sigintHandler = () => this.stop();
    this.exitHandler = () => this.stop();
    process.on('SIGINT', this.sigintHandler);
    process.on('exit', this.exitHandler);
    this.handleResize();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.disableRawMode();
    this.stdout.write(SHOW_CURSOR);
    this.stdout.write(DISABLE_MOUSE);
    if (this.altScreenActive) {
      this.stdout.write(EXIT_ALT_SCREEN);
      this.altScreenActive = false;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.stopAnimation();
    // Remove event listeners to prevent memory leaks on re-start
    if (this.sigintHandler) {
      process.removeListener('SIGINT', this.sigintHandler);
      this.sigintHandler = null;
    }
    if (this.exitHandler) {
      process.removeListener('exit', this.exitHandler);
      this.exitHandler = null;
    }
    if (this.sigwinchHandler) {
      process.removeListener('SIGWINCH', this.sigwinchHandler);
      this.sigwinchHandler = null;
    }
    if (this.dataHandler) {
      this.stdin.removeListener('data', this.dataHandler);
      this.dataHandler = null;
    }
  }

  private enableRawMode(): void {
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(true);
      this.stdin.resume();
    }
  }

  private disableRawMode(): void {
    if (this.stdin.isTTY) {
      try { this.stdin.setRawMode(false); } catch {}
    }
  }

  private handleResize(): void {
    this.sigwinchHandler = () => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.width = this.stdout.columns || 80;
        this.height = this.stdout.rows || 24;
        this.cache = null;
        this.render();
      }, 100);
    };
    process.on('SIGWINCH', this.sigwinchHandler);
  }

  requestRender(): void {
    this.cache = null;
    this.dirty = true;
    this.render();
  }

  requestDiffRender(): void {
    this.dirty = true;
    this.render();
  }

  private startInputLoop(): void {
    this.dataHandler = (data: Buffer) => {
      if (!this.running) return;
      this.processInput(data.toString());
    };
    this.stdin.on('data', this.dataHandler);
  }

  private processInput(data: string): void {
    this.inputBuffer += data;

    // Process all characters in buffer
    while (this.inputBuffer.length > 0) {
      // Check for mouse events first
      if (this.inputBuffer.startsWith('\x1b[M') || this.inputBuffer.startsWith('\x1b[<')) {
        const mouseEnd = this.inputBuffer.search(/(M$|[A-Z])/);
        if (mouseEnd >= 0 && mouseEnd < this.inputBuffer.length - 1) {
          this.inputBuffer = '';
          return;
        }
        return; // Wait for more data
      }

      // Escape sequence matching
      if (this.inputBuffer[0] === '\x1b') {
        const seqMatch = this.inputBuffer.match(/^(\x1b\[[0-9;]*[A-Za-z]|\x1b\][0-9]*;[^\x07]*\x07|\x1b[^\[].?|\x1b)/);
        if (seqMatch) {
          const seq = seqMatch[0];
          this.inputBuffer = this.inputBuffer.slice(seq.length);
          this.handleEscapeSequence(seq);
          continue;
        }
        // Partial escape sequence — wait for more
        if (this.inputBuffer.length < 4) return;
        // Unknown/incomplete — flush this escape
        this.inputBuffer = this.inputBuffer.slice(1);
        continue;
      }

      // Regular character
      const char = this.inputBuffer[0];
      this.inputBuffer = this.inputBuffer.slice(1);

      // Check keybindings
      if (this.keybindingHandler && this.kbManager) {
        // Check Ctrl+letter combos
        const code = char.charCodeAt(0);
        if (code < 32 && code !== 13 && code !== 10) {
          const ctrlId = `ctrl+${String.fromCharCode(code + 96)}`;
          const action = this.kbManager.getAction(ctrlId);
          if (action) { this.keybindingHandler(action); this.render(); continue; }
        }
      }

      // Hardcoded handlers (lowest priority)
      if (char === '\x03') { this.stop(); return; }
      if (char === '\x0c') {
        this.cache = null;
        this.stdout.write(ERASE_DISPLAY);
        this.stdout.write(CURSOR_HOME);
        this.render();
        continue;
      }

      // Pass to global input handler (e.g., overlay) first
      if (this.globalInputHandler && this.globalInputHandler(char)) {
        this.render();
        continue;
      }

      // Pass to focused component
      if (this.focusable.length > 0) {
        const focused = this.focusable[this.focusIndex];
        if (focused.handleInput) focused.handleInput(char);
      }
      this.render();
    }
  }

  private handleEscapeSequence(seq: string): void {
    // Global input handler gets first shot at escape sequences (for overlay)
    if (this.globalInputHandler && this.globalInputHandler(seq)) {
      this.render();
      return;
    }

    if (this.keybindingHandler && this.kbManager) {
      // Map escape sequences to key IDs
      const keyId = ansiKeyToId(seq);
      if (keyId) {
        const action = this.kbManager.getAction(keyId);
        if (action) { this.keybindingHandler(action); this.render(); return; }
      }
    }

    if (seq === '\x1b') {
      if (this.keybindingHandler && this.kbManager) {
        const action = this.kbManager.getAction('escape');
        if (action) { this.keybindingHandler(action); this.render(); }
      } else if (this.keybindingHandler) {
        this.keybindingHandler('escape');
        this.render();
      }
    } else if (seq === '\x1b[A' || seq === '\x1b[B') {
      if (this.focusable.length > 0) {
        this.focusable[this.focusIndex].focused = false;
        this.focusIndex = seq === '\x1b[A'
          ? (this.focusIndex - 1 + this.focusable.length) % this.focusable.length
          : (this.focusIndex + 1) % this.focusable.length;
        this.focusable[this.focusIndex].focused = true;
        this.render();
      }
    } else if (['\x1b[D', '\x1b[C', '\x1b[H', '\x1b[F'].includes(seq)) {
      if (this.focusable.length > 0) {
        const f = this.focusable[this.focusIndex];
        if (f.handleInput) f.handleInput(seq);
        this.render();
      }
    }
  }

  private render(): void {
    if (!this.running || !this.root) return;
    if (!this.dirty && !this.animating) return;

    // Rate-limit rendering
    const now = Date.now();
    if (now - this.lastRenderTime < this.minRenderInterval) return;
    this.lastRenderTime = now;
    this.dirty = false;

    const newLines = this.root.render(this.width);
    const newCache: RenderCache = { lines: newLines, width: this.width };

    if (this.cache && this.cache.width === this.width) {
      this.renderDiff(this.cache.lines, newLines);
    } else {
      this.renderFull(newLines);
    }
    this.cache = newCache;
  }

  private renderFull(lines: readonly string[]): void {
    this.allLines = lines;
    this.stdout.write(CURSOR_HOME);
    this.stdout.write(ERASE_DISPLAY);
    // Auto-scroll: show the LAST N lines that fit on screen, not the first N.
    // If the user has scrolled up, show from the scrolled position.
    const visibleCount = Math.min(lines.length, this.height - 1);
    let startIdx: number;
    if (this.scrollOffset > 0) {
      // User scrolled up — show from (bottom - scrollOffset).
      startIdx = Math.max(0, lines.length - visibleCount - this.scrollOffset);
    } else {
      // Normal — show the tail (newest output).
      startIdx = Math.max(0, lines.length - visibleCount);
    }
    for (let i = 0; i < visibleCount; i++) {
      this.stdout.write(lines[startIdx + i] + '\r\n');
    }
    // Show scroll indicator if scrolled up.
    if (this.scrollOffset > 0) {
      const indicator = `↑ scrolled up ${this.scrollOffset} lines (PageDn to go down)`;
      this.stdout.write(`\x1b[${this.height};1H\x1b[2K\x1b[33m${indicator}\x1b[0m`);
    }
  }

  private renderDiff(oldLines: readonly string[], newLines: readonly string[]): void {
    this.allLines = newLines;
    // If user is scrolled up, don't auto-scroll — just update the display
    // at the current scroll position. New content will be visible when they
    // scroll back to the bottom.
    if (this.scrollOffset > 0) {
      // Force a full render at the scrolled position.
      this.renderFull(newLines);
      return;
    }
    // Both oldLines and newLines are the FULL line arrays. We need to
    // compute the visible window (tail) for both, then diff within that
    // window. This ensures scrolling works: when new lines push old lines
    // off-screen, the diff correctly re-renders the shifted content.
    const visibleCount = Math.min(newLines.length, this.height - 1);
    const newStart = Math.max(0, newLines.length - visibleCount);
    const oldVisibleCount = Math.min(oldLines.length, this.height - 1);
    const oldStart = Math.max(0, oldLines.length - oldVisibleCount);

    let firstDiff = -1;
    let lastDiff = -1;

    for (let i = 0; i < visibleCount; i++) {
      const oldL = oldLines[oldStart + i] || '';
      const newL = newLines[newStart + i] || '';
      if (oldL !== newL) {
        if (firstDiff === -1) firstDiff = i;
        lastDiff = i;
      }
    }

    if (firstDiff === -1) return; // No changes

    // Only redraw changed lines within the visible window.
    for (let i = firstDiff; i <= lastDiff; i++) {
      const newL = newLines[newStart + i] || '';
      this.stdout.write(`\x1b[${i + 1};1H`);
      this.stdout.write(ERASE_LINE);
      this.stdout.write(newL);
    }

    // Position cursor at the end of visible content.
    const promptLine = Math.min(visibleCount, this.height - 1);
    this.stdout.write(`\x1b[${promptLine + 1};1H`);
  }
}
