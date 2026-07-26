/**
 * Voice pipeline — audio transcription and synthesis stubs.
 */

export interface VoiceConfig {
  enabled: boolean;
  transcriptionModel?: string;
  synthesisModel?: string;
  sampleRate: number;
  channels: number;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  enabled: false,
  sampleRate: 16000,
  channels: 1,
};

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language?: string;
  durationMs: number;
}

/**
 * Transcribe audio to text (stub).
 */
export async function transcribe(
  _audioBuffer: Buffer,
  _config: VoiceConfig = DEFAULT_VOICE_CONFIG,
): Promise<TranscriptionResult> {
  return {
    text: '',
    confidence: 0,
    durationMs: 0,
  };
}

/**
 * Synthesize text to audio (stub).
 */
export async function synthesize(
  _text: string,
  _config: VoiceConfig = DEFAULT_VOICE_CONFIG,
): Promise<Buffer | null> {
  return null;
}
