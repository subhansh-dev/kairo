/**
 * TTS (Text-to-Speech) — voice synthesis integration.
 */

export interface TTSOptions {
  text: string;
  voice?: string;
  speed?: number;
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  model?: string;
}

export interface TTSResult {
  audioUrl?: string;
  audioBase64?: string;
  duration?: number;
  error?: string;
}

/**
 * Build a TTS request.
 */
export function buildTTSRequest(opts: TTSOptions): Record<string, unknown> {
  return {
    input: opts.text,
    voice: opts.voice || 'alloy',
    speed: opts.speed || 1.0,
    response_format: opts.format || 'mp3',
    model: opts.model || 'tts-1',
  };
}

/**
 * Format TTS result for display.
 */
export function formatTTSResult(result: TTSResult): string {
  if (result.error) return `TTS Error: ${result.error}`;
  const parts = ['Audio generated successfully.'];
  if (result.audioUrl) parts.push(`URL: ${result.audioUrl}`);
  if (result.duration) parts.push(`Duration: ${result.duration.toFixed(1)}s`);
  return parts.join('\n');
}

/**
 * Available TTS voices.
 */
export const TTS_VOICES = [
  'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer',
  'ash', 'ballad', 'coral', 'sage', 'verse',
];

/**
 * Get voice description.
 */
export function getVoiceDescription(voice: string): string {
  const descriptions: Record<string, string> = {
    alloy: 'Neutral, balanced',
    echo: 'Male, clear',
    fable: 'British accent, expressive',
    onyx: 'Deep, authoritative',
    nova: 'Female, warm',
    shimmer: 'Female, soft',
  };
  return descriptions[voice] || voice;
}

/**
 * Validate TTS options.
 */
export function validateTTSOptions(opts: TTSOptions): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!opts.text || opts.text.trim().length === 0) errors.push('Text is required');
  if (opts.text && opts.text.length > 4096) errors.push('Text too long (max 4096 chars)');
  if (opts.speed && (opts.speed < 0.25 || opts.speed > 4.0)) errors.push('Speed must be 0.25-4.0');
  if (opts.voice && !TTS_VOICES.includes(opts.voice)) errors.push(`Unknown voice: ${opts.voice}`);
  return { valid: errors.length === 0, errors };
}
