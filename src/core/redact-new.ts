/**
 * Regex-based secret redaction for logs and tool output.
 *
 * Applies pattern matching to mask API keys, tokens, and credentials
 * before they reach log files or verbose output.
 */

// Known API key prefixes — match the prefix + contiguous token chars
const PREFIX_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g,           // OpenAI / OpenRouter / Anthropic
  /ghp_[A-Za-z0-9]{10,}/g,            // GitHub PAT (classic)
  /github_pat_[A-Za-z0-9_]{10,}/g,    // GitHub PAT (fine-grained)
  /gho_[A-Za-z0-9]{10,}/g,            // GitHub OAuth access token
  /ghu_[A-Za-z0-9]{10,}/g,            // GitHub user-to-server token
  /ghs_[A-Za-z0-9]{10,}/g,            // GitHub server-to-server token
  /ghr_[A-Za-z0-9]{10,}/g,            // GitHub refresh token
  /xapp-\d+-[A-Za-z0-9-]{10,}/g,      // Slack app-level token
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,    // Slack bot/app/user tokens
  /AIza[A-Za-z0-9_-]{30,}/g,          // Google API keys
  /pplx-[A-Za-z0-9]{10,}/g,           // Perplexity
  /fal_[A-Za-z0-9_-]{10,}/g,          // Fal.ai
  /fc-[A-Za-z0-9]{10,}/g,             // Firecrawl
  /bb_live_[A-Za-z0-9_-]{10,}/g,      // BrowserBase
  /gAAAA[A-Za-z0-9_=-]{20,}/g,        // Encrypted tokens
  /AKIA[A-Z0-9]{16}/g,                // AWS Access Key ID
  /sk_live_[A-Za-z0-9]{10,}/g,        // Stripe secret key (live)
  /sk_test_[A-Za-z0-9]{10,}/g,        // Stripe secret key (test)
  /rk_live_[A-Za-z0-9]{10,}/g,        // Stripe restricted key
  /SG\.[A-Za-z0-9_-]{10,}/g,          // SendGrid API key
  /hf_[A-Za-z0-9]{10,}/g,             // HuggingFace token
  /r8_[A-Za-z0-9]{10,}/g,             // Replicate API token
  /npm_[A-Za-z0-9]{10,}/g,            // npm access token
  /pypi-[A-Za-z0-9_-]{10,}/g,         // PyPI API token
  /dop_v1_[A-Za-z0-9]{10,}/g,         // DigitalOcean PAT
  /sk_[A-Za-z0-9_]{10,}/g,            // ElevenLabs TTS key
  /tvly-[A-Za-z0-9]{10,}/g,           // Tavily search API key
  /nvapi-[A-Za-z0-9-]{10,}/g,         // NVIDIA NIM API key
  /gsk_[A-Za-z0-9]{10,}/g,            // Groq API key
  /csk_[A-Za-z0-9]{10,}/g,            // Cerebras API key
];

// Bearer token pattern
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]{20,}/gi;

// Generic long hex/base64 strings that look like tokens
const GENERIC_TOKEN_RE = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g;

/**
 * Mask a token string. Short tokens are fully masked; longer ones
 * preserve the first 6 and last 4 characters for debuggability.
 */
function maskToken(token: string): string {
  if (token.length < 18) return '***';
  return token.slice(0, 6) + '***' + token.slice(-4);
}

/**
 * Redact sensitive information from text.
 * Applies pattern matching to mask API keys, tokens, and credentials.
 */
export function redactSensitiveText(text: string, force = false): string {
  if (!text) return text;

  // Check if redaction is disabled
  if (!force && process.env.KAIRO_REDACT_SECRETS?.toLowerCase() === 'false') {
    return text;
  }

  let result = text;

  // Apply prefix patterns
  for (const pattern of PREFIX_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match) => maskToken(match));
  }

  // Redact Bearer tokens
  result = result.replace(BEARER_RE, 'Bearer ***');

  return result;
}

/**
 * Check if text contains what looks like a secret.
 */
export function containsSecret(text: string): boolean {
  if (!text) return false;
  for (const pattern of PREFIX_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  BEARER_RE.lastIndex = 0;
  return BEARER_RE.test(text);
}

/**
 * Redact secrets from an object's string values.
 */
export function redactObjectSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = redactSensitiveText(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
