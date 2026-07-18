const REDACTED = '[REDACTED_SECRET]';
const REDACTED_URL_VALUE = 'redacted';

// ─── Regex Patterns ────────────────────────────────────────

// Vendor API keys with sk- prefixes
const API_KEY_PREFIX_RE = /\b(?:sk[-_])[A-Za-z0-9_-]{20,}/g;
// AWS long-term (AKIA) and temporary (ASIA) access keys
const AWS_ACCESS_KEY_RE = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
// GitHub PATs: classic (ghp_/gho_/ghu_/ghs_/ghr_) + fine-grained (github_pat_)
const GITHUB_TOKEN_RE = /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g;
// GitLab (glpat-) and Slack (xoxa-/xoxb-/xoxp-/xapp-) tokens
const VENDOR_TOKEN_RE = /\b(?:glpat-|xox[abp]-|xapp-)[A-Za-z0-9-]{10,}/g;
// Google API keys (AIza + 35 chars)
const GOOGLE_API_KEY_RE = /\bAIza[0-9A-Za-z_-]{35}/g;
// PEM private-key block
const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
// Bearer tokens
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._\-]{16,}\b/g;
// Bare JWT (eyJ...header.payload.signature)
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
// Secret assignments (api_key = "value", token: "value", etc.)
const SECRET_ASSIGNMENT_RE = /\b(api[_-]?(?:key)|(?:access|refresh|id)[_-]token|token|secret|client[_-]secret|password)\b(\s*[:=]\s*)(["']?)[^\s"',&]{8,}/gi;

// Sensitive URL query parameters
const SENSITIVE_QUERY_PARAMS = new Set([
  'access_token', 'api_key', 'assertion', 'auth', 'client_secret',
  'code', 'code_verifier', 'id_token', 'key', 'password',
  'refresh_token', 'requested_token', 'session_id', 'state',
  'subject_token', 'token',
]);

// URL pattern
const URL_RE = /https?:\/\/[^\s"'<>(){}\[\],;`]+/g;

// Home directory patterns for path redaction
const HOME_ROOT_USER_RE = /([/\\](?:Users|home)[/\\])([^/\\]+)/g;

// ─── Core Redaction ────────────────────────────────────────

/**
 * Redact secrets from a string. Returns the original string if no matches.
 */
export function redactSecrets(input: string): string {
  if (!API_KEY_PREFIX_RE.test(input) &&
      !AWS_ACCESS_KEY_RE.test(input) &&
      !GITHUB_TOKEN_RE.test(input) &&
      !VENDOR_TOKEN_RE.test(input) &&
      !GOOGLE_API_KEY_RE.test(input) &&
      !PEM_PRIVATE_KEY_RE.test(input) &&
      !BEARER_TOKEN_RE.test(input) &&
      !JWT_RE.test(input) &&
      !URL_RE.test(input) &&
      !SECRET_ASSIGNMENT_RE.test(input)) {
    return input;
  }

  // Reset regex lastIndex since we used .test()
  [API_KEY_PREFIX_RE, AWS_ACCESS_KEY_RE, GITHUB_TOKEN_RE, VENDOR_TOKEN_RE,
   GOOGLE_API_KEY_RE, PEM_PRIVATE_KEY_RE, BEARER_TOKEN_RE, JWT_RE,
   URL_RE, SECRET_ASSIGNMENT_RE].forEach(r => r.lastIndex = 0);

  let s = input;
  s = s.replace(PEM_PRIVATE_KEY_RE, REDACTED);
  s = s.replace(API_KEY_PREFIX_RE, REDACTED);
  s = s.replace(AWS_ACCESS_KEY_RE, REDACTED);
  s = s.replace(GITHUB_TOKEN_RE, REDACTED);
  s = s.replace(VENDOR_TOKEN_RE, REDACTED);
  s = s.replace(GOOGLE_API_KEY_RE, REDACTED);
  s = s.replace(BEARER_TOKEN_RE, `Bearer ${REDACTED}`);
  s = s.replace(JWT_RE, REDACTED);
  s = redactUrlsIn(s);
  s = s.replace(SECRET_ASSIGNMENT_RE, `$1$2$3${REDACTED}`);
  return s;
}

/**
 * Redact secrets from JSON string values (in-place mutation).
 */
export function redactJsonStringValues(value: any): void {
  walkJsonStrings(value, (s) => {
    const redacted = redactSecrets(s);
    if (redacted !== s) return redacted;
    return s;
  });
}

/**
 * Walk all string values in a JSON object and apply a transform function.
 */
export function walkJsonStrings(value: any, f: (s: string) => string): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    const result = f(value);
    if (result !== value) {
      // We can't mutate in-place for primitives, so this is a helper
      // for callers who own the reference
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkJsonStrings(item, f);
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const val = value[key];
      if (typeof val === 'string') {
        const result = f(val);
        if (result !== val) value[key] = result;
      } else {
        walkJsonStrings(val, f);
      }
    }
  }
}

// ─── URL Redaction ─────────────────────────────────────────

function redactUrlsIn(text: string): string {
  return text.replace(URL_RE, (raw) => {
    try {
      const url = new URL(raw);
      redactUrl(url);
      return url.toString();
    } catch {
      return raw;
    }
  });
}

/**
 * Redact sensitive query params, credentials, and fragments from a URL.
 */
export function redactUrl(url: URL): void {
  url.username = '';
  url.password = '';
  url.hash = '';

  const params = url.searchParams;
  const toRedact: string[] = [];
  for (const [key] of params) {
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      toRedact.push(key);
    }
  }
  for (const key of toRedact) {
    params.set(key, REDACTED_URL_VALUE);
  }
}

// ─── User Path Redaction ───────────────────────────────────

/**
 * Collapse $HOME to ~ and username segments to <user>.
 */
export function redactUserPaths(input: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const username = process.env.USERNAME || process.env.USER || '';

  let s = input;

  // Collapse HOME to ~
  if (home && s.includes(home)) {
    s = replaceHomePrefix(s, home);
  }

  // Collapse username segments
  if (username && username.length >= 3) {
    s = redactUsernameSegments(s, username);
  }

  // Backstop: if env is unavailable, use regex
  if (!home && !username) {
    s = s.replace(HOME_ROOT_USER_RE, '$1<user>');
  }

  return s;
}

function replaceHomePrefix(input: string, home: string): string {
  let out = '';
  let rest = input;
  let idx: number;
  while ((idx = rest.indexOf(home)) !== -1) {
    const before = rest.slice(0, idx);
    const after = rest.slice(idx + home.length);
    const prevOk = before.length === 0 || isSegmentBoundary(before[before.length - 1]);
    const nextOk = after.length === 0 || isSegmentBoundary(after[0]);
    out += before;
    out += (prevOk && nextOk) ? '~' : home;
    rest = after;
  }
  out += rest;
  return out;
}

function isSegmentBoundary(c: string): boolean {
  return !(/[a-zA-Z0-9_\-.]/.test(c));
}

function redactUsernameSegments(value: string, username: string): string {
  const boundary = /[^a-zA-Z0-9_\-.]/;
  let out = '';
  let buf = '';
  for (const ch of value) {
    if (boundary.test(ch)) {
      out += (buf.toLowerCase() === username.toLowerCase()) ? '<user>' : buf;
      out += ch;
      buf = '';
    } else {
      buf += ch;
    }
  }
  out += (buf.toLowerCase() === username.toLowerCase()) ? '<user>' : buf;
  return out;
}

// ─── Exports ───────────────────────────────────────────────

export {
  REDACTED,
  SENSITIVE_QUERY_PARAMS,
};
