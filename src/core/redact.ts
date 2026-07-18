/**
 * Kairo — Redact
 * Regex-based secret redaction for logs and tool output.
 * Ported from Hermes Agent's redact.py
 */

// ─── Patterns ───────────────────────────────────────────────────

const PATTERNS: Array<{ name: string; regex: RegExp; replacement: string | ((match: string) => string) }> = [
  // API keys with known prefixes
  { name: 'nvidia', regex: /nvapi-[A-Za-z0-9_-]{20,}/g, replacement: 'nvapi-***' },
  { name: 'groq', regex: /gsk_[A-Za-z0-9_-]{20,}/g, replacement: 'gsk_***' },
  { name: 'cerebras', regex: /csk-[A-Za-z0-9_-]{20,}/g, replacement: 'csk-***' },
  { name: 'openai', regex: /sk-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-***' },
  { name: 'anthropic', regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-ant-***' },
  { name: 'github', regex: /ghp_[A-Za-z0-9]{30,}/g, replacement: 'ghp_***' },
  { name: 'github_pat', regex: /github_pat_[A-Za-z0-9_]{30,}/g, replacement: 'github_pat_***' },
  // Generic tokens
  { name: 'bearer', regex: /Bearer\s+[A-Za-z0-9_-]{20,}/gi, replacement: 'Bearer ***' },
  { name: 'authorization', regex: /Authorization:\s*[A-Za-z0-9_-]{20,}/gi, replacement: 'Authorization: ***' },
  // JWT tokens
  { name: 'jwt', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: 'eyJ***' },
  // Generic long tokens (32+ chars of alphanumeric)
  { name: 'generic_token', regex: /\b[A-Za-z0-9]{32,}\b/g, replacement: (match: string) => {
    if (match.length < 18) return match;
    return match.slice(0, 6) + '***' + match.slice(-4);
  }},
];

// ─── Redaction ──────────────────────────────────────────────────

/**
 * Redact sensitive information from text.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of PATTERNS) {
    if (typeof pattern.replacement === 'string') {
      result = result.replace(pattern.regex, pattern.replacement);
    } else {
      result = result.replace(pattern.regex, pattern.replacement);
    }
  }
  return result;
}

/**
 * Check if text contains potential secrets.
 */
export function containsSecrets(text: string): boolean {
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) return true;
  }
  return false;
}

/**
 * Redact secrets from a structured object (recursive).
 */
export function redactObject(obj: any): any {
  if (typeof obj === 'string') return redactSecrets(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact values of sensitive keys
      if (isSensitiveKey(key) && typeof value === 'string') {
        result[key] = redactSecrets(value);
      } else {
        result[key] = redactObject(value);
      }
    }
    return result;
  }
  return obj;
}

/**
 * Check if a key name suggests sensitive content.
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('key') || lower.includes('token') || lower.includes('secret') ||
    lower.includes('password') || lower.includes('auth') || lower.includes('credential');
}
