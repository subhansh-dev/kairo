import type { Message } from '../providers/types.js';

export interface SecretEntry {
  type: 'plain' | 'regex';
  content: string;
  mode?: 'obfuscate' | 'replace';
  replacement?: string;
  flags?: string;
}

const REPLACEMENT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const HASH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HASH_LEN = 4;
const PLACEHOLDER_RE = /#[A-Z0-9]{4}#/g;

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function xxHash32(str: string): number {
  let h1 = 0x9e3779b9 | 0;
  let h2 = 0x85ebca6b | 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0xcc9e2d51);
    h2 = Math.imul(h2 ^ c, 0x1b873593);
  }
  h1 ^= str.length;
  h2 ^= str.length;
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35);
  return Math.abs((h1 ^ h2) >>> 0);
}

function generateDeterministicReplacement(secret: string): string {
  const hash = simpleHash(secret);
  const chars: string[] = [];
  let h = hash;
  for (let i = 0; i < secret.length; i++) {
    h = h ^ ((i + 1) * 0x9e3779b9);
    h = h & 0x7fffffff;
    const idx = h % REPLACEMENT_CHARS.length;
    chars.push(REPLACEMENT_CHARS[idx]);
  }
  return chars.join('');
}

function buildPlaceholder(index: number): string {
  let v = xxHash32(String(index));
  let tag = '#';
  for (let i = 0; i < HASH_LEN; i++) {
    tag += HASH_CHARS[v % HASH_CHARS.length];
    v = Math.floor(v / HASH_CHARS.length);
  }
  return `${tag}#`;
}

function replaceAll(text: string, search: string, replacement: string): string {
  if (search.length === 0) return text;
  let result = text;
  let idx = result.indexOf(search);
  while (idx !== -1) {
    result = result.slice(0, idx) + replacement + result.slice(idx + search.length);
    idx = result.indexOf(search, idx + replacement.length);
  }
  return result;
}

function deepWalkStrings<T>(obj: T, transform: (s: string) => string): T {
  if (typeof obj === 'string') return transform(obj) as T;
  if (Array.isArray(obj)) {
    let changed = false;
    const result = obj.map(item => {
      const t = deepWalkStrings(item, transform);
      if (t !== item) changed = true;
      return t;
    });
    return (changed ? result : obj) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) return obj;
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const val = (obj as Record<string, unknown>)[key];
      const t = deepWalkStrings(val, transform);
      if (t !== val) changed = true;
      result[key] = t;
    }
    return (changed ? result : obj) as T;
  }
  return obj;
}

function compileSecretRegex(pattern: string, flags?: string): RegExp {
  return new RegExp(pattern, flags);
}

export class SecretObfuscator {
  #plainMappings = new Map<string, number>();
  #regexEntries: Array<{ regex: RegExp; mode: 'obfuscate' | 'replace'; replacement?: string }> = [];
  #obfuscateMappings = new Map<number, { secret: string; placeholder: string }>();
  #replaceMappings = new Map<string, string>();
  #deobfuscateMap = new Map<string, string>();
  #nextIndex: number;
  #hasAny: boolean;

  constructor(entries: SecretEntry[]) {
    let index = 0;
    for (const entry of entries) {
      const mode = entry.mode ?? 'obfuscate';
      if (entry.type === 'plain') {
        if (mode === 'obfuscate') {
          const placeholder = buildPlaceholder(index);
          this.#plainMappings.set(entry.content, index);
          this.#obfuscateMappings.set(index, { secret: entry.content, placeholder });
          this.#deobfuscateMap.set(placeholder, entry.content);
          index++;
        } else {
          this.#replaceMappings.set(entry.content, entry.replacement ?? generateDeterministicReplacement(entry.content));
        }
      } else {
        try {
          const regex = compileSecretRegex(entry.content, entry.flags);
          this.#regexEntries.push({ regex, mode, replacement: entry.replacement });
        } catch {}
      }
    }
    this.#nextIndex = index;
    this.#hasAny = entries.length > 0;
  }

  hasSecrets(): boolean {
    return this.#hasAny;
  }

  obfuscate(text: string): string {
    if (!this.#hasAny) return text;
    let result = text;

    for (const [secret, replacement] of [...this.#replaceMappings].sort((a, b) => b[0].length - a[0].length)) {
      result = replaceAll(result, secret, replacement);
    }

    for (const [secret, index] of [...this.#plainMappings].sort((a, b) => b[0].length - a[0].length)) {
      const mapping = this.#obfuscateMappings.get(index)!;
      result = replaceAll(result, secret, mapping.placeholder);
    }

    for (const entry of this.#regexEntries) {
      entry.regex.lastIndex = 0;
      const matches = new Set<string>();
      for (;;) {
        const match = entry.regex.exec(result);
        if (match === null) break;
        if (match[0].length === 0) { entry.regex.lastIndex++; continue; }
        matches.add(match[0]);
      }

      for (const matchValue of matches) {
        if (entry.mode === 'replace') {
          result = replaceAll(result, matchValue, entry.replacement ?? generateDeterministicReplacement(matchValue));
        } else {
          let idx = this.#plainMappings.get(matchValue);
          if (idx === undefined) {
            for (const [i, m] of this.#obfuscateMappings) {
              if (m.secret === matchValue) { idx = i; break; }
            }
          }
          if (idx === undefined) {
            idx = this.#nextIndex++;
            const placeholder = buildPlaceholder(idx);
            this.#obfuscateMappings.set(idx, { secret: matchValue, placeholder });
            this.#deobfuscateMap.set(placeholder, matchValue);
          }
          const mapping = this.#obfuscateMappings.get(idx)!;
          result = replaceAll(result, matchValue, mapping.placeholder);
        }
      }
    }

    return result;
  }

  deobfuscate(text: string): string {
    if (!this.#hasAny || !text.includes('#')) return text;
    return text.replace(PLACEHOLDER_RE, match => this.#deobfuscateMap.get(match) ?? match);
  }

  deobfuscateObject<T>(obj: T): T {
    if (!this.#hasAny) return obj;
    return deepWalkStrings(obj, s => this.deobfuscate(s));
  }

  obfuscateObject<T>(obj: T): T {
    if (!this.#hasAny) return obj;
    return deepWalkStrings(obj, s => this.obfuscate(s));
  }
}

const MIN_ENV_VALUE_LENGTH = 8;
const SECRET_ENV_PATTERNS = /(?:KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL|PRIVATE|OAUTH)(?:_|$)/i;

export function collectEnvSecrets(): SecretEntry[] {
  const entries: SecretEntry[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < MIN_ENV_VALUE_LENGTH) continue;
    if (!SECRET_ENV_PATTERNS.test(name)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    entries.push({ type: 'plain', content: value, mode: 'obfuscate' });
  }
  return entries;
}

export function collectConfigSecrets(config: Record<string, { apiKey?: string; apiKeys?: string[] }>): SecretEntry[] {
  const entries: SecretEntry[] = [];
  for (const [provider, cfg] of Object.entries(config)) {
    if (cfg.apiKey) entries.push({ type: 'plain', content: cfg.apiKey, mode: 'obfuscate' });
    if (cfg.apiKeys) {
      for (const key of cfg.apiKeys) {
        if (key) entries.push({ type: 'plain', content: key, mode: 'obfuscate' });
      }
    }
  }
  return entries;
}

export function obfuscateMessages(obfuscator: SecretObfuscator, messages: Message[]): Message[] {
  return obfuscator.obfuscateObject(messages);
}
