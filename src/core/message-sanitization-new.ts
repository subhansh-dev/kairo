/**
 * Message and tool-payload sanitization helpers.
 *
 * Pure functions that walk OpenAI-format message lists and structured payloads,
 * repairing or stripping problematic characters.
 */

// Lone surrogate code points are invalid in UTF-8 and crash JSON.stringify
const SURROGATE_RE = /[\ud800-\udfff]/g;

/**
 * Replace lone surrogate code points with U+FFFD (replacement character).
 * Surrogates are invalid in UTF-8 and will crash JSON.stringify.
 */
export function sanitizeSurrogates(text: string): string {
  if (SURROGATE_RE.test(text)) {
    SURROGATE_RE.lastIndex = 0;
    return text.replace(SURROGATE_RE, '\ufffd');
  }
  return text;
}

/**
 * Sanitize surrogate characters from nested dict/list payloads in-place.
 * Returns true if any surrogates were replaced.
 */
export function sanitizeStructureSurrogates(payload: unknown): boolean {
  let found = false;

  function walk(node: unknown): void {
    if (typeof node === 'string') return; // handled by caller
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const value = node[i];
        if (typeof value === 'string') {
          if (SURROGATE_RE.test(value)) {
            SURROGATE_RE.lastIndex = 0;
            node[i] = value.replace(SURROGATE_RE, '\ufffd');
            found = true;
          }
        } else if (typeof value === 'object' && value !== null) {
          walk(value);
        }
      }
    } else if (typeof node === 'object' && node !== null) {
      const obj = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          if (SURROGATE_RE.test(value)) {
            SURROGATE_RE.lastIndex = 0;
            obj[key] = value.replace(SURROGATE_RE, '\ufffd');
            found = true;
          }
        } else if (typeof value === 'object' && value !== null) {
          walk(value);
        }
      }
    }
  }

  walk(payload);
  return found;
}

/**
 * Sanitize surrogate characters from all string content in a messages list.
 * Walks message dicts in-place. Returns true if any surrogates were found.
 */
export function sanitizeMessagesSurrogates(messages: Array<Record<string, unknown>>): boolean {
  let found = false;

  for (const msg of messages) {
    // Sanitize content
    if (typeof msg.content === 'string') {
      if (SURROGATE_RE.test(msg.content)) {
        SURROGATE_RE.lastIndex = 0;
        msg.content = msg.content.replace(SURROGATE_RE, '\ufffd');
        found = true;
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && typeof (part as any).text === 'string') {
          if (SURROGATE_RE.test((part as any).text)) {
            SURROGATE_RE.lastIndex = 0;
            (part as any).text = (part as any).text.replace(SURROGATE_RE, '\ufffd');
            found = true;
          }
        }
      }
    }

    // Sanitize name
    if (typeof msg.name === 'string') {
      if (SURROGATE_RE.test(msg.name)) {
        SURROGATE_RE.lastIndex = 0;
        msg.name = msg.name.replace(SURROGATE_RE, '\ufffd');
        found = true;
      }
    }

    // Sanitize tool calls
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (typeof tc === 'object' && tc !== null) {
          const fn = (tc as any).function;
          if (typeof fn === 'object' && fn !== null) {
            if (typeof fn.arguments === 'string') {
              if (SURROGATE_RE.test(fn.arguments)) {
                SURROGATE_RE.lastIndex = 0;
                fn.arguments = fn.arguments.replace(SURROGATE_RE, '\ufffd');
                found = true;
              }
            }
          }
        }
      }
    }
  }

  return found;
}

/**
 * Close an interrupted tool-call sequence.
 * When a turn is interrupted mid-tool-call, appends a synthetic assistant
 * message to close the sequence.
 */
export function closeInterruptedToolSequence(
  messages: Array<Record<string, unknown>>,
  finalResponse?: string,
): void {
  // Find the last assistant message with tool_calls
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // Check if there are matching tool results
      const toolCallIds = new Set(
        msg.tool_calls.map((tc: any) => tc.id || tc.call_id).filter(Boolean)
      );
      const hasResults = messages.slice(i + 1).some(
        m => m.role === 'tool' && toolCallIds.has(m.tool_call_id as string)
      );

      if (!hasResults) {
        // Append a synthetic assistant message to close the sequence
        messages.push({
          role: 'assistant',
          content: finalResponse || '[Interrupted]',
        });
      }
      break;
    }
  }
}
