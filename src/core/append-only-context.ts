/**
 * Kairo — Append-Only Context
 * Stabilizes the byte prefix sent to the LLM across turns so provider
 * prefix caches (DeepSeek, Anthropic, etc.) hit at maximum rate.
 *
 * Two mechanisms:
 * 1. StablePrefix — system prompt + tool specs computed once and frozen.
 *    Subsequent turns reuse the exact same byte sequence unless invalidated.
 * 2. AppendOnlyLog — messages only grow; prior turns are never re-serialized.
 *    Only the user's new message delta is a cache miss each turn.
 */

import { createHash } from 'crypto';

// ─── Stable Prefix ─────────────────────────────────────────

export interface StablePrefixSnapshot {
  systemPrompt: string;
  tools: string; // serialized tool specs
  fingerprint: string;
}

/**
 * Frozen system prompt + tool spec snapshot.
 * First build() snapshots live state; subsequent calls reuse cached copy
 * until invalidate() is called or fingerprint changes.
 */
export class StablePrefix {
  private snapshot: StablePrefixSnapshot | null = null;
  private _version = 0;

  get fingerprint(): string {
    return this.snapshot?.fingerprint ?? '<unbuilt>';
  }
  get version(): number {
    return this._version;
  }
  get built(): boolean {
    return this.snapshot !== null;
  }

  /**
   * Build or rebuild from live context.
   * Returns true if the prefix actually changed (cache miss imminent).
   */
  build(systemPrompt: string, toolsSpec: string): boolean {
    const fingerprint = createHash('md5')
      .update(systemPrompt)
      .update(toolsSpec)
      .digest('hex');

    if (this.snapshot && this.snapshot.fingerprint === fingerprint) {
      return false; // No change — cache hit
    }

    this.snapshot = { systemPrompt, tools: toolsSpec, fingerprint };
    this._version++;
    return true; // Changed — cache miss
  }

  /** Force rebuild on next build() call. */
  invalidate(): void {
    this.snapshot = null;
  }

  /** Returns the cached prefix. Throws if never built. */
  get(): { systemPrompt: string; tools: string } {
    if (!this.snapshot) throw new Error('StablePrefix.get() called before build()');
    return { systemPrompt: this.snapshot.systemPrompt, tools: this.snapshot.tools };
  }
}

// ─── Append-Only Log ───────────────────────────────────────

/**
 * Append-only message log. The only mutation path is replaceTail(),
 * reserved for compaction. Every other operation is append-only.
 */
export class AppendOnlyLog<T> {
  private entries: T[] = [];

  get length(): number {
    return this.entries.length;
  }

  append(message: T): void {
    this.entries.push(message);
  }

  extend(messages: T[]): void {
    for (const m of messages) this.entries.push(m);
  }

  /** Replace the last entry — only legal for compaction. */
  replaceTail(replacement: T): void {
    const idx = this.entries.length - 1;
    if (idx >= 0) this.entries[idx] = replacement;
  }

  /** Returns a shallow copy of all entries. */
  toMessages(): T[] {
    return this.entries.slice();
  }

  /** Direct readonly access. */
  all(): readonly T[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }
}

// ─── Context Manager ───────────────────────────────────────

/**
 * Manages a stable prefix + append-only log for the agent loop.
 * Call build() each turn to get messages with stable prefix.
 * Call syncMessages() after each turn to keep the log in sync.
 */
export class AppendOnlyContextManager<T> {
  readonly prefix = new StablePrefix();
  readonly log = new AppendOnlyLog<T>();
  private lastSyncCount = 0;

  build(systemPrompt: string, toolsSpec: string): { systemPrompt: string; tools: string; messages: readonly T[] } {
    this.prefix.build(systemPrompt, toolsSpec);
    const { systemPrompt: sp, tools } = this.prefix.get();
    return { systemPrompt: sp, tools, messages: this.log.all() };
  }

  /**
   * Sync new messages into the log. Only appends messages after lastSyncCount.
   * Returns true if new messages were added.
   */
  syncMessages(messages: T[]): boolean {
    if (messages.length <= this.lastSyncCount) return false;
    const newMessages = messages.slice(this.lastSyncCount);
    this.log.extend(newMessages);
    this.lastSyncCount = messages.length;
    return true;
  }

  clear(): void {
    this.prefix.invalidate();
    this.log.clear();
    this.lastSyncCount = 0;
  }
}
