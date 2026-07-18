/**
 * Stateful scrubber for reasoning/thinking blocks in streamed assistant text.
 *
 * When models like DeepSeek or MiniMax stream thinking blocks, this scrubber
 * removes them from the visible output. Partial tags at delta boundaries are
 * held back until the next delta resolves them.
 *
 * Usage:
 *   const scrubber = new StreamingThinkScrubber();
 *   for (const delta of stream) {
 *     const visible = scrubber.feed(delta);
 *     if (visible) emit(visible);
 *   }
 *   const tail = scrubber.flush();
 *   if (tail) emit(tail);
 */

const OPEN_TAG_NAMES = ['think', 'thinking', 'reasoning', 'thought', 'REASONING_SCRATCHPAD'];
const OPEN_TAGS = OPEN_TAG_NAMES.map(n => `<${n}>`);
const CLOSE_TAGS = OPEN_TAG_NAMES.map(n => `</${n}>`);
const MAX_TAG_LEN = Math.max(...[...OPEN_TAGS, ...CLOSE_TAGS].map(t => t.length));

export class StreamingThinkScrubber {
  private inBlock = false;
  private buf = '';
  private lastEmittedEndedNewline = true;

  /**
   * Reset all state. Call at the top of every new turn.
   */
  reset(): void {
    this.inBlock = false;
    this.buf = '';
    this.lastEmittedEndedNewline = true;
  }

  /**
   * Feed one delta; return the scrubbed visible portion.
   * May return '' when the entire delta is reasoning content.
   */
  feed(text: string): string {
    if (!text) return '';
    let buf = this.buf + text;
    this.buf = '';
    const out: string[] = [];

    while (buf.length > 0) {
      if (this.inBlock) {
        // Hunt for the earliest close tag
        const { index: closeIdx, length: closeLen } = this.findFirstTag(buf, CLOSE_TAGS);
        if (closeIdx === -1) {
          // No close yet — hold back potential partial close-tag prefix
          const held = this.maxPartialSuffix(buf, CLOSE_TAGS);
          this.buf = held > 0 ? buf.slice(-held) : '';
          return out.join('');
        }
        // Found close: discard block content + tag, continue
        buf = buf.slice(closeIdx + closeLen);
        this.inBlock = false;
      } else {
        // Priority 1: closed <tag>X</tag> pair anywhere
        const pair = this.findEarliestClosedPair(buf);
        // Priority 2: unterminated open tag at block boundary
        const { index: openIdx, length: openLen } = this.findOpenAtBoundary(buf, out);

        // Pick whichever match comes earliest
        if (pair !== null && (openIdx === -1 || pair[0] <= openIdx)) {
          const [startIdx, endIdx] = pair;
          const preceding = buf.slice(0, startIdx);
          if (preceding) {
            const stripped = this.stripOrphanCloseTags(preceding);
            if (stripped) {
              out.push(stripped);
              this.lastEmittedEndedNewline = stripped.endsWith('\n');
            }
          }
          buf = buf.slice(endIdx);
          continue;
        }

        if (openIdx !== -1) {
          // Unterminated open at boundary
          const preceding = buf.slice(0, openIdx);
          if (preceding) {
            const stripped = this.stripOrphanCloseTags(preceding);
            if (stripped) {
              out.push(stripped);
              this.lastEmittedEndedNewline = stripped.endsWith('\n');
            }
          }
          this.inBlock = true;
          buf = buf.slice(openIdx + openLen);
          continue;
        }

        // No resolvable tag structure — hold back partial-tag prefix
        const heldOpen = this.maxPartialSuffix(buf, OPEN_TAGS);
        const heldClose = this.maxPartialSuffix(buf, CLOSE_TAGS);
        const held = Math.max(heldOpen, heldClose);
        if (held > 0) {
          const emitText = buf.slice(0, -held);
          this.buf = buf.slice(-held);
          if (emitText) {
            const stripped = this.stripOrphanCloseTags(emitText);
            if (stripped) {
              out.push(stripped);
              this.lastEmittedEndedNewline = stripped.endsWith('\n');
            }
          }
        } else {
          const stripped = this.stripOrphanCloseTags(buf);
          if (stripped) {
            out.push(stripped);
            this.lastEmittedEndedNewline = stripped.endsWith('\n');
          }
          this.buf = '';
        }
        return out.join('');
      }
    }

    return out.join('');
  }

  /**
   * End-of-stream flush. If still inside an unterminated block,
   * held-back content is discarded (partial reasoning is worse than
   * a truncated answer).
   */
  flush(): string {
    if (this.inBlock) {
      this.buf = '';
      this.inBlock = false;
      this.lastEmittedEndedNewline = true;
      return '';
    }
    const tail = this.buf;
    this.buf = '';
    this.lastEmittedEndedNewline = true;
    if (!tail) return '';
    return this.stripOrphanCloseTags(tail);
  }

  // ── internal helpers ───────────────────────────────────────────────

  private findFirstTag(buf: string, tags: readonly string[]): { index: number; length: number } {
    const bufLower = buf.toLowerCase();
    let bestIdx = -1;
    let bestLen = 0;
    for (const tag of tags) {
      const idx = bufLower.indexOf(tag.toLowerCase());
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx;
        bestLen = tag.length;
      }
    }
    return { index: bestIdx, length: bestLen };
  }

  private findEarliestClosedPair(buf: string): [number, number] | null {
    const bufLower = buf.toLowerCase();
    let best: [number, number] | null = null;
    for (let i = 0; i < OPEN_TAGS.length; i++) {
      const openLower = OPEN_TAGS[i].toLowerCase();
      const closeLower = CLOSE_TAGS[i].toLowerCase();
      const openIdx = bufLower.indexOf(openLower);
      if (openIdx === -1) continue;
      const closeIdx = bufLower.indexOf(closeLower, openIdx + openLower.length);
      if (closeIdx === -1) continue;
      const endIdx = closeIdx + closeLower.length;
      if (best === null || openIdx < best[0]) {
        best = [openIdx, endIdx];
      }
    }
    return best;
  }

  private findOpenAtBoundary(buf: string, alreadyEmitted: string[]): { index: number; length: number } {
    const bufLower = buf.toLowerCase();
    let bestIdx = -1;
    let bestLen = 0;
    for (const tag of OPEN_TAGS) {
      const tagLower = tag.toLowerCase();
      let searchStart = 0;
      while (true) {
        const idx = bufLower.indexOf(tagLower, searchStart);
        if (idx === -1) break;
        if (this.isBlockBoundary(buf, idx, alreadyEmitted)) {
          if (bestIdx === -1 || idx < bestIdx) {
            bestIdx = idx;
            bestLen = tag.length;
          }
          break;
        }
        searchStart = idx + 1;
      }
    }
    return { index: bestIdx, length: bestLen };
  }

  private isBlockBoundary(buf: string, idx: number, alreadyEmitted: string[]): boolean {
    if (idx === 0) {
      if (alreadyEmitted.length > 0) {
        return alreadyEmitted[alreadyEmitted.length - 1].endsWith('\n');
      }
      return this.lastEmittedEndedNewline;
    }
    const preceding = buf.slice(0, idx);
    const lastNl = preceding.lastIndexOf('\n');
    if (lastNl === -1) {
      const priorNewline = alreadyEmitted.length > 0
        ? alreadyEmitted[alreadyEmitted.length - 1].endsWith('\n')
        : this.lastEmittedEndedNewline;
      return priorNewline && preceding.trim() === '';
    }
    return preceding.slice(lastNl + 1).trim() === '';
  }

  private maxPartialSuffix(buf: string, tags: readonly string[]): number {
    if (!buf.length) return 0;
    const bufLower = buf.toLowerCase();
    const maxCheck = Math.min(bufLower.length, MAX_TAG_LEN - 1);
    for (let i = maxCheck; i > 0; i--) {
      const suffix = bufLower.slice(-i);
      for (const tag of tags) {
        const tagLower = tag.toLowerCase();
        if (tagLower.length > i && tagLower.startsWith(suffix)) {
          return i;
        }
      }
    }
    return 0;
  }

  private stripOrphanCloseTags(text: string): string {
    if (!text.includes('</')) return text;
    const textLower = text.toLowerCase();
    const out: string[] = [];
    let i = 0;
    while (i < text.length) {
      let matched = false;
      if (textLower.slice(i, i + 2) === '</') {
        for (const tag of CLOSE_TAGS) {
          const tagLower = tag.toLowerCase();
          if (textLower.slice(i, i + tagLower.length) === tagLower) {
            let j = i + tagLower.length;
            while (j < text.length && ' \t\n\r'.includes(text[j])) j++;
            i = j;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        out.push(text[i]);
        i++;
      }
    }
    return out.join('');
  }
}
