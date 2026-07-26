/**
 * Kairo — Message Sanitization
 * Unicode repair, JSON repair, non-ASCII stripping for safe LLM transport
 */

// ─── Surrogate Repair ──────────────────────────────────────

const SURROGATE_RE = /[\uD800-\uDFFF]/g;

function sanitizeSurrogates(text: string): string {
  return text.replace(SURROGATE_RE, (match) => {
    const code = match.charCodeAt(0);
    if (code >= 0xD800 && code <= 0xDBFF) return '\uFFFD';
    if (code >= 0xDC00 && code <= 0xDFFF) return '\uFFFD';
    return match;
  });
}

// ─── Non-ASCII Stripping ───────────────────────────────────

/**
 * Strip or replace non-ASCII characters that cause issues with some LLM providers
 */
export function sanitizeNonASCII(text: string, mode: 'strip' | 'replace' | 'preserve' = 'preserve'): string {
  if (mode === 'preserve') return text;
  if (mode === 'strip') return text.replace(/[^\x20-\x7E\n\r\t]/g, '');
  return text.replace(/[^\x20-\x7E\n\r\t]/g, (c) => {
    if (c === '\n' || c === '\r' || c === '\t') return c;
    return ' ';
  });
}

// ─── JSON Repair ───────────────────────────────────────────

/**
 * Repair common JSON formatting issues from LLM output
 */
export function repairJSON(text: string): string {
  let result = text.trim();

  // Remove markdown code fences
  result = result.replace(/^```(?:json)?\s*\n?/i, '');
  result = result.replace(/\n?\s*```$/i, '');

  // Fix trailing commas
  result = result.replace(/,\s*([}\]])/g, '$1');

  // Fix single quotes to double quotes
  result = result.replace(/'/g, '"');

  // Fix unquoted keys
  result = result.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

  // Fix trailing whitespace before closing
  result = result.replace(/\s+([}\]])/g, '$1');

  return result;
}

// ─── Full Message Sanitization ─────────────────────────────

export interface SanitizeOptions {
  stripSurrogates: boolean;
  nonASCII: 'strip' | 'replace' | 'preserve';
  maxLength: number;
  trimWhitespace: boolean;
}

const DEFAULT_OPTIONS: SanitizeOptions = {
  stripSurrogates: true,
  nonASCII: 'preserve',
  maxLength: 1_000_000,
  trimWhitespace: true,
};

export function sanitizeMessage(text: string, options: Partial<SanitizeOptions> = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let result = text;

  if (opts.stripSurrogates) result = sanitizeSurrogates(result);
  if (opts.nonASCII !== 'preserve') result = sanitizeNonASCII(result, opts.nonASCII);
  if (opts.trimWhitespace) result = result.trim();
  if (result.length > opts.maxLength) result = result.slice(0, opts.maxLength);

  return result;
}

/**
 * Sanitize an array of messages for provider transport
 */
export function sanitizeMessages<T extends { content: string }>(
  messages: T[],
  options?: Partial<SanitizeOptions>,
): T[] {
  return messages.map(msg => ({
    ...msg,
    content: sanitizeMessage(msg.content, options),
  }));
}


/**
 * Strip  tags used for reasoning/thinking content display
 * These are used to separate thinking from response text
 */
export function scrubThinkTags(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<thinking\/>/g, '')
    .replace(/<thought>[\s\S]*?<\/thought>/g, '')
    .trim();
}

/**
 * Extract thinking content from  blocks
 */
export function extractThinkContent(text: string): { thinking: string; response: string } {
  const match = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const thinking = match ? match[1].trim() : '';
  const response = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
  return { thinking, response };
}
