/**
 * Unified credential source management.
 *
 * Manages different credential sources (env vars, config files, OAuth, etc.)
 * with a unified removal contract.
 */

export interface RemovalResult {
  cleaned: string[];
  hints: string[];
  suppress: boolean;
}

export interface CredentialSource {
  type: string;     // 'env' | 'config' | 'oauth' | 'manual' | 'file'
  key: string;      // The credential key/value
  source: string;   // Where it came from (e.g., 'NVIDIA_API_KEY', 'config.yaml')
}

// Known credential source types
const SOURCE_TYPES = ['env', 'config', 'oauth', 'manual', 'file'] as const;

/**
 * Get all credential sources from the environment.
 */
export function getEnvCredentialSources(): CredentialSource[] {
  const sources: CredentialSource[] = [];
  const envKeys = [
    'NVIDIA_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY',
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY',
    'OPENROUTER_API_KEY', 'TOGETHER_API_KEY', 'FIREWORKS_API_KEY',
    'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'MISTRAL_API_KEY',
  ];

  for (const key of envKeys) {
    const value = process.env[key];
    if (value) {
      const provider = key.replace('_API_KEY', '').toLowerCase();
      sources.push({
        type: 'env',
        key: value,
        source: key,
      });
    }
  }

  return sources;
}

/**
 * Remove a credential source.
 */
export function removeCredentialSource(source: CredentialSource): RemovalResult {
  const cleaned: string[] = [];
  const hints: string[] = [];

  switch (source.type) {
    case 'env':
      cleaned.push(`Would clear ${source.source} from environment`);
      hints.push(`Run: unset ${source.source}`);
      break;
    case 'config':
      cleaned.push(`Would remove from config file`);
      break;
    case 'oauth':
      cleaned.push(`Would revoke OAuth tokens`);
      break;
    case 'manual':
      cleaned.push(`Would remove manual credential`);
      break;
    default:
      hints.push(`Unknown source type: ${source.type}`);
  }

  return { cleaned, hints, suppress: true };
}

/**
 * Mask a credential for display.
 */
export function maskCredentialForDisplay(key: string): string {
  if (key.length < 18) return '***';
  return key.slice(0, 6) + '***' + key.slice(-4);
}

/**
 * Get a human-readable description of a credential source.
 */
export function describeCredentialSource(source: CredentialSource): string {
  switch (source.type) {
    case 'env': return `Environment variable: ${source.source}`;
    case 'config': return `Config file: ${source.source}`;
    case 'oauth': return `OAuth: ${source.source}`;
    case 'manual': return `Manual entry`;
    case 'file': return `File: ${source.source}`;
    default: return `Unknown: ${source.source}`;
  }
}
