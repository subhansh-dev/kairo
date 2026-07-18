import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';

export type KeyId =
  | 'ctrl+c' | 'ctrl+d' | 'ctrl+l' | 'ctrl+z' | 'ctrl+o'
  | 'ctrl+p' | 'ctrl+n' | 'ctrl+r' | 'ctrl+s' | 'ctrl+t'
  | 'ctrl+w' | 'ctrl+x' | 'ctrl+y' | 'ctrl+u' | 'ctrl+k'
  | 'ctrl+b' | 'ctrl+f' | 'ctrl+a' | 'ctrl+e' | 'ctrl+h'
  | 'ctrl+g' | 'ctrl+q' | 'ctrl+v' | 'ctrl+i'
  | 'escape' | 'tab' | 'shift+tab' | 'enter'
  | 'backspace' | 'space'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5'
  | 'f6' | 'f7' | 'f8' | 'f9' | 'f10'
  | 'f11' | 'f12'
  | 'up' | 'down' | 'left' | 'right'
  | 'pageup' | 'pagedown' | 'home' | 'end'
  | 'insert' | 'delete'
  | `ctrl+${string}` | `alt+${string}`;

export interface KeybindingDef {
  defaultKeys: string;
  description: string;
  keys?: string;
}

export interface KeybindingAction {
  actionId: string;
  description: string;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

export class KeybindingsManager {
  private bindings: Map<string, string> = new Map();
  private actions: Map<string, KeybindingAction> = new Map();
  private multiKeyBuffer: string[] = [];
  private multiKeyTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadDefaults();
    this.loadUserConfig();
  }

  private loadDefaults(): void {
    const defaults: Record<string, string> = {
      'ctrl+c': 'interrupt',
      'ctrl+d': 'exit',
      'ctrl+l': 'clear',
      'ctrl+z': 'suspend',
      'ctrl+o': 'model.cycleForward',
      'ctrl+p': 'model.select',
      'ctrl+r': 'session.search',
      'ctrl+s': 'session.save',
      'ctrl+t': 'thinking.toggle',
      'ctrl+w': 'session.toggleSort',
      'ctrl+n': 'session.new',
      'ctrl+y': 'redo',
      'ctrl+u': 'undo',
      'ctrl+k': 'clearInput',
      'ctrl+e': 'inputEnd',
      'ctrl+a': 'agents.toggle',
      'ctrl+f': 'moveForward',
      'ctrl+b': 'moveBack',
      'escape': 'interrupt',
      'tab': 'complete',
      'shift+tab': 'thinking.cycle',
      'enter': 'submit',
      'backspace': 'deleteBack',
      'space': 'insertSpace',
      'f1': 'help',
      'f2': 'status',
      'f3': 'tools',
      'f5': 'retry',
    };

    // Add alt+letter defaults (prefix commands)
    for (const ch of ALPHABET) {
      defaults[`alt+${ch}`] = `prefix.${ch}`;
    }

    for (const [key, action] of Object.entries(defaults)) {
      this.bindings.set(key, action);
    }
  }

  private loadUserConfig(): void {
    const paths = [
      join(homedir(), '.kairo', 'keybindings.yml'),
      join(homedir(), '.kairo', 'keybindings.yaml'),
      join(homedir(), '.kairo', 'keybindings.json'),
    ];
    for (const p of paths) {
      if (!existsSync(p)) continue;
      try {
        const raw = readFileSync(p, 'utf-8');
        const config: Record<string, string> = p.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
        for (const [key, action] of Object.entries(config)) {
          this.bindings.set(key.toLowerCase(), action);
        }
      } catch {}
    }
  }

  getAction(key: string): string | undefined {
    return this.bindings.get(key);
  }

  getKeyForAction(actionId: string): string | undefined {
    for (const [key, action] of this.bindings) {
      if (action === actionId) return key;
    }
    return undefined;
  }

  getAllBindings(): Array<{ key: string; action: string }> {
    return Array.from(this.bindings.entries()).map(([k, a]) => ({ key: k, action: a }));
  }

  setBinding(key: string, action: string): void {
    this.bindings.set(key.toLowerCase(), action);
  }

  removeBinding(key: string): void {
    this.bindings.delete(key.toLowerCase());
  }

  resetToDefaults(): void {
    this.bindings.clear();
    this.loadDefaults();
    this.loadUserConfig();
  }

  formatForHelp(): string[] {
    const byAction = new Map<string, string[]>();
    for (const [key, action] of this.bindings) {
      const existing = byAction.get(action) || [];
      existing.push(key);
      byAction.set(action, existing);
    }
    return Array.from(byAction.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([action, keys]) => `  ${keys.join('/')} → ${action}`);
  }
}

export function ansiKeyToId(seq: string): string | undefined {
  const map: Record<string, string> = {
    '\x1b': 'escape',
    '\x1b[A': 'up',
    '\x1b[B': 'down',
    '\x1b[C': 'right',
    '\x1b[D': 'left',
    '\x1b[H': 'home',
    '\x1b[F': 'end',
    '\x1b[2~': 'insert',
    '\x1b[3~': 'delete',
    '\x1b[5~': 'pageup',
    '\x1b[6~': 'pagedown',
    '\x1bOP': 'f1',
    '\x1bOQ': 'f2',
    '\x1bOR': 'f3',
    '\x1bOS': 'f4',
    '\x1b[15~': 'f5',
    '\x1b[17~': 'f6',
    '\x1b[18~': 'f7',
    '\x1b[19~': 'f8',
    '\x1b[20~': 'f9',
    '\x1b[21~': 'f10',
    '\x1b[23~': 'f11',
    '\x1b[24~': 'f12',
    '\x1b[Z': 'shift+tab',
  };
  return map[seq];
}
