/**
 * Lightweight internationalization (i18n) for Kairo static user-facing messages.
 *
 * Only the highest-impact static strings shown to the user.
 * Agent-generated output stays in English.
 */

export type SupportedLanguage = 'en' | 'zh' | 'ja' | 'de' | 'es' | 'fr' | 'tr' | 'uk' | 'ko' | 'it' | 'pt' | 'ru';

const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  'en', 'zh', 'ja', 'de', 'es', 'fr', 'tr', 'uk', 'ko', 'it', 'pt', 'ru',
];

const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

// Language aliases
const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  'english': 'en', 'en-us': 'en', 'en-gb': 'en',
  'chinese': 'zh', 'mandarin': 'zh', 'zh-cn': 'zh', 'zh-hans': 'zh',
  'japanese': 'ja', 'jp': 'ja',
  'german': 'de', 'deutsch': 'de',
  'spanish': 'es', 'español': 'es',
  'french': 'fr', 'français': 'fr',
  'ukrainian': 'uk',
  'turkish': 'tr', 'türkçe': 'tr',
  'korean': 'ko', '한국어': 'ko',
  'italian': 'it', 'italiano': 'it',
  'portuguese': 'pt', 'português': 'pt',
  'russian': 'ru', 'русский': 'ru',
};

// Built-in message catalog (English only — add more as needed)
const CATALOG: Record<string, Record<string, string>> = {
  en: {
    'approval.choose': 'Allow this action?',
    'approval.allow': 'Allow',
    'approval.deny': 'Deny',
    'approval.allow_always': 'Always allow',
    'gateway.draining': 'Draining {count} active session(s)…',
    'gateway.ready': 'Gateway ready',
    'session.created': 'Session created',
    'session.resumed': 'Session resumed',
    'session.cleared': 'Session cleared',
    'error.no_providers': 'No providers configured. Set API keys in ~/.kairo/models.yml',
    'error.timeout': 'Request timed out',
    'error.rate_limited': 'Rate limited — retrying in {seconds}s',
    'status.ready': 'Ready',
    'status.processing': 'Processing…',
    'status.streaming': 'Streaming…',
  },
  zh: {
    'approval.choose': '允许此操作？',
    'approval.allow': '允许',
    'approval.deny': '拒绝',
    'error.no_providers': '未配置提供商。请在 ~/.kairo/models.yml 中设置 API 密钥',
    'status.ready': '就绪',
  },
};

let currentLanguage: SupportedLanguage = DEFAULT_LANGUAGE;

/**
 * Resolve a language string to a supported language.
 */
function resolveLanguage(lang?: string): SupportedLanguage {
  if (!lang) return currentLanguage;
  const lower = lang.toLowerCase().trim();
  const alias = LANGUAGE_ALIASES[lower];
  if (alias) return alias;
  if (SUPPORTED_LANGUAGES.includes(lower as SupportedLanguage)) {
    return lower as SupportedLanguage;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Set the current language.
 */
export function setLanguage(lang: string): void {
  currentLanguage = resolveLanguage(lang);
}

/**
 * Get the current language.
 */
export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

/**
 * Translate a key to the current language.
 * Supports {placeholder} formatting.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = currentLanguage;

  // Try current language, then English, then return the key
  let template = CATALOG[lang]?.[key] || CATALOG[DEFAULT_LANGUAGE]?.[key] || key;

  // Apply parameters
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      template = template.replace(`{${k}}`, String(v));
    }
  }

  return template;
}

/**
 * Translate with explicit language override.
 */
export function tl(key: string, lang: string, params?: Record<string, string | number>): string {
  const prev = currentLanguage;
  currentLanguage = resolveLanguage(lang);
  const result = t(key, params);
  currentLanguage = prev;
  return result;
}

/**
 * Initialize i18n from environment.
 */
export function initI18n(): void {
  const envLang = process.env.KAIRO_LANGUAGE || process.env.LANG?.split('.')[0];
  if (envLang) setLanguage(envLang);
}
