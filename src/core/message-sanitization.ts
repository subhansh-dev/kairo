/**
 * Kairo — Message Sanitization
 * Sanitize messages before sending to LLM APIs.
 * Ported from Hermes Agent's message_sanitization.py
 *
 * Handles: surrogate code points, non-ASCII in headers, tool argument repair.
 */

// ─── Surrogate Handling ─────────────────────────────────────────

const SURROGATE_RE = /[\ud800-\udfff]/g;

/**
 * Replace lone surrogate code points with U+FFFD.
 * Surrogates crash json.dumps() inside API SDKs.
 */
export function sanitizeSurrogates(text: string): string {
  if (!SURROGATE_RE.test(text)) return text;
  SURROGATE_RE.lastIndex = 0;
  return text.replace(SURROGATE_RE, '\uFFFD');
}

/**
 * Sanitize surrogates in nested dict/list payloads.
 */
export function sanitizeStructureSurrogates(payload: any): boolean {
  let found = false;
  function walk(node: any): void {
    if (typeof node === 'string') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string') {
          if (SURROGATE_RE.test(node[i])) {
            node[i] = node[i].replace(SURROGATE_RE, '\uFFFD');
            found = true;
          }
          SURROGATE_RE.lastIndex = 0;
        } else if (typeof node[i] === 'object' && node[i] !== null) {
          walk(node[i]);
        }
      }
    } else if (typeof node === 'object' && node !== null) {
      for (const key of Object.keys(node)) {
        if (typeof node[key] === 'string') {
          if (SURROGATE_RE.test(node[key])) {
            node[key] = node[key].replace(SURROGATE_RE, '\uFFFD');
            found = true;
          }
          SURROGATE_RE.lastIndex = 0;
        } else if (typeof node[key] === 'object' && node[key] !== null) {
          walk(node[key]);
        }
      }
    }
  }
  walk(payload);
  return found;
}

/**
 * Sanitize all string fields in a message list.
 */
export function sanitizeMessages(messages: any[]): any[] {
  return messages.map(m => {
    const result = { ...m };
    if (typeof result.content === 'string') {
      result.content = sanitizeSurrogates(result.content);
    }
    if (result.tool_calls) {
      result.tool_calls = result.tool_calls.map((tc: any) => {
        if (tc.function?.arguments) {
          return { ...tc, function: { ...tc.function, arguments: sanitizeSurrogates(tc.function.arguments) } };
        }
        return tc;
      });
    }
    return result;
  });
}

// ─── Non-ASCII Stripping ────────────────────────────────────────

/**
 * Strip non-ASCII characters from text.
 * Some APIs reject non-ASCII in certain fields.
 */
export function stripNonAscii(text: string): string {
  return text.replace(/[^\x00-\x7F]/g, '');
}

/**
 * Strip non-ASCII from tool schemas (function names, parameter names).
 */
export function sanitizeToolSchemas(tools: any[]): any[] {
  return tools.map(t => {
    if (t.function?.name) {
      t.function.name = t.function.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    return t;
  });
}

// ─── Tool Call Argument Repair ───────────────────────────────────

/**
 * Attempt to repair malformed tool call arguments.
 * Models sometimes emit invalid JSON or missing required fields.
 */
export function repairToolCallArguments(rawArgs: string, toolName: string): { args: string; repaired: boolean } {
  if (!rawArgs) return { args: '{}', repaired: true };

  // Try parsing as-is
  try {
    JSON.parse(rawArgs);
    return { args: rawArgs, repaired: false };
  } catch {}

  // Attempt repairs
  let fixed = rawArgs;

  // Fix common issues
  // 1. Trailing comma
  fixed = fixed.replace(/,\s*([\]}])/g, '$1');
  // 2. Missing closing brace
  const openBraces = (fixed.match(/{/g) || []).length;
  const closeBraces = (fixed.match(/}/g) || []).length;
  if (openBraces > closeBraces) {
    fixed += '}'.repeat(openBraces - closeBraces);
  }
  // 3. Unescaped newlines in string values
  fixed = fixed.replace(/(?<="[^"]*)\n(?=[^"]*")/g, '\\n');

  try {
    JSON.parse(fixed);
    return { args: fixed, repaired: true };
  } catch {}

  // Last resort: wrap in object
  return { args: JSON.stringify({ raw: rawArgs }), repaired: true };
}

// ─── Interrupted Tool Sequence ───────────────────────────────────

/**
 * Close interrupted tool call sequences.
 * If the model was interrupted mid-tool-call, add a synthetic error result.
 */
export function closeInterruptedToolSequence(messages: any[]): any[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;

  // Check if last message is an assistant message with tool_calls but no matching results
  if (last.role === 'assistant' && last.tool_calls?.length > 0) {
    const toolCallIds = new Set(last.tool_calls.map((tc: any) => tc.id));
    const resultIds = new Set(
      messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)
    );

    for (const tc of last.tool_calls) {
      if (!resultIds.has(tc.id)) {
        // Add synthetic error result
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({
            error: 'Tool execution was interrupted',
            status: 'cancelled',
          }),
        });
      }
    }
  }

  return messages;
}

// ─── Image Stripping ─────────────────────────────────────────────

/**
 * Strip image content from messages for providers that don't support it.
 */
export function stripImages(messages: any[]): any[] {
  return messages.map(m => {
    if (Array.isArray(m.content)) {
      m.content = m.content
        .filter((block: any) => block.type !== 'image')
        .map((block: any) => {
          if (block.type === 'image_url') {
            return { type: 'text', text: '[image removed]' };
          }
          return block;
        });
      if (m.content.length === 0) {
        m.content = '[images removed]';
      }
    }
    return m;
  });
}
