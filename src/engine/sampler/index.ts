/**
 * LLM sampler interface — abstracts LLM calls for compaction and other uses.
 */

export interface SamplerMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
}

export interface SamplerConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  stop?: string[];
}

export interface SamplerResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
}

export interface SamplerError {
  type: 'rate_limit' | 'auth' | 'network' | 'model_error' | 'unknown';
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export type SamplerFn = (
  systemPrompt: string,
  messages: SamplerMessage[],
  config: SamplerConfig,
) => Promise<SamplerResult | SamplerError>;

/**
 * Check if a sampler result is an error.
 */
export function isSamplerError(result: SamplerResult | SamplerError): result is SamplerError {
  return 'type' in result && 'message' in result && !('content' in result);
}

/**
 * Create a default sampler config.
 */
export function defaultSamplerConfig(model: string): SamplerConfig {
  return {
    model,
    temperature: 0.0,
    maxTokens: 4096,
  };
}
