/**
 * Kairo — Dialect Factory
 * Maps providers to their dialect implementations
 */

import type { Dialect, DialectDefinition } from '../types.js';
import { openaiDialect } from './openai.js';
import { deepseekDialect } from './deepseek.js';
import { kimiDialect } from './kimi.js';
import { anthropicDialect } from './anthropic.js';
import { geminiDialect } from './gemini.js';

const DIALECT_MAP: Record<string, DialectDefinition> = {
  openai: openaiDialect,
  deepseek: deepseekDialect,
  kimi: kimiDialect,
  anthropic: anthropicDialect,
  gemini: geminiDialect,
  // OpenAI-compatible providers
  groq: openaiDialect,
  cerebras: openaiDialect,
  nvidia: openaiDialect,
  openrouter: openaiDialect,
};

// Provider-to-dialect mapping
const PROVIDER_DIALECT: Record<string, Dialect> = {
  groq: 'openai',
  cerebras: 'openai',
  nvidia: 'openai',
  openrouter: 'openai',
  gemini: 'gemini',
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  kimi: 'kimi',
  moonshot: 'kimi',
};

export function getDialect(providerOrDialect: string): DialectDefinition {
  // Direct dialect match
  if (DIALECT_MAP[providerOrDialect]) {
    return DIALECT_MAP[providerOrDialect];
  }
  // Provider-to-dialect lookup
  const dialect = PROVIDER_DIALECT[providerOrDialect];
  if (dialect && DIALECT_MAP[dialect]) {
    return DIALECT_MAP[dialect];
  }
  // Default to OpenAI dialect (most compatible)
  return openaiDialect;
}

export function getDialectForProvider(provider: string): Dialect {
  return PROVIDER_DIALECT[provider] || 'openai';
}

export { openaiDialect, deepseekDialect, kimiDialect, anthropicDialect, geminiDialect };
export type { Dialect, DialectDefinition };
