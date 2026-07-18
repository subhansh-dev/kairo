/**
 * Kairo — Enhanced Provider with Dialect Support
 * Full streaming, thinking, tool calling, retry, and dialect-aware parsing
 */

import type {
  Provider, ProviderConfig, Message, StreamOptions,
  AssistantMessageEvent, AssistantMessageEventStream,
  Usage, Dialect,
} from './types.js';
import { ProviderError } from './types.js';
import { getDialect, getDialectForProvider } from './dialects/index.js';
import { getCredentialPool } from './credential-pool.js';

export class EnhancedProvider implements Provider {
  private _dialect: Dialect;
  private _models: string[];
  private _rateLimitState = { requests: 0, tokens: 0, resetAt: 0 };
  private _pool = getCredentialPool();
  private _lastKey: string = '';

  constructor(protected config: ProviderConfig) {
    this._dialect = config.dialect || getDialectForProvider(config.name);
    this._models = config.models || [];
    this._lastKey = config.apiKey;
  }

  get name() { return this.config.name; }
  get available() { return this._pool.get(this.name) !== null || !!this.config.apiKey; }
  get dialect() { return this._dialect; }
  get models() { return this._models; }

  async chat(messages: Message[], model: string, options: StreamOptions = {}): Promise<AssistantMessageEvent[]> {
    const dialectDef = getDialect(this._dialect);
    const body = dialectDef.buildRequestBody(messages, { ...options });
    body.model = model;
    body.stream = false;

    const resp = await this.makeRequest(body, options.signal);
    const data = await resp.json() as any;

    const events: AssistantMessageEvent[] = [];
    const choice = data.choices?.[0];
    if (choice?.message?.content) {
      events.push({ type: 'text', text: choice.message.content });
    }
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        events.push({
          type: 'tool_call_end',
          id: tc.id || '',
          name: tc.function?.name || '',
          arguments: JSON.parse(tc.function?.arguments || '{}'),
        });
      }
    }
    if (data.usage) {
      events.push({
        type: 'usage',
        usage: {
          input: data.usage.prompt_tokens || 0,
          output: data.usage.completion_tokens || 0,
          cacheRead: data.usage.cache_read_input_tokens || 0,
          cacheWrite: 0,
          totalTokens: (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0),
        },
      });
    }
    events.push({ type: 'done' });
    return events;
  }

  async *stream(messages: Message[], model: string, options: StreamOptions = {}): AssistantMessageEventStream {
    const dialectDef = getDialect(this._dialect);
    const body = dialectDef.buildRequestBody(messages, { ...options });
    body.model = model;

    // Debug: log request body
    // console.error('[DEBUG] Request body:', JSON.stringify(body, null, 2));

    const resp = await this.makeRequest(body, options.signal);

    const reader = resp.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        chunkCount++;
        // console.error('[DEBUG] Chunk', chunkCount, ':', buffer.slice(0, 200));
        
        const events = dialectDef.parseStreamChunk(buffer);
        buffer = '';

        for (const event of events) {
          yield event;
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const events = dialectDef.parseStreamChunk(buffer);
        for (const event of events) {
          yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    if (this._models.length > 0) return this._models;

    try {
      const url = `${this.config.baseUrl}/models`;
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      });
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      return (data.data || []).map((m: any) => m.id);
    } catch {
      return [];
    }
  }

  private async makeRequest(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    this.checkRateLimit();

    // Get best available key from credential pool
    const poolKey = this._pool.get(this.name);
    const key = poolKey || this._lastKey;
    this._lastKey = key;

    const url = `${this.config.baseUrl}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const err = await resp.text();
      const retryAfter = resp.headers.get('retry-after');
      const error = new ProviderError(
        this.config.name,
        resp.status,
        err.slice(0, 300),
        retryAfter ? parseInt(retryAfter) : undefined,
      );
      this._pool.reportFailure(this.name, key, error);
      throw error;
    }

    this._pool.reportSuccess(this.name, key);
    this._rateLimitState.requests++;
    return resp;
  }

  private checkRateLimit() {
    const now = Date.now();
    if (now > this._rateLimitState.resetAt) {
      this._rateLimitState = { requests: 0, tokens: 0, resetAt: now + 60000 };
    }
    if (this.config.rateLimit &&
        this._rateLimitState.requests >= this.config.rateLimit.requestsPerMinute) {
      throw new ProviderError(this.config.name, 429, 'Rate limit exceeded', 60);
    }
  }
}
