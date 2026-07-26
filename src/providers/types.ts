/**
 * Kairo — Provider Types
 * Core types for the multi-provider, multi-dialect system
 */

// ─── Message Types ──────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export interface ToolCallContent {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_call_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export type ContentBlock = TextContent | ImageContent | ToolCallContent | ToolResultContent | ThinkingContent;

export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
  timestamp?: number;
  attribution?: string;
}

// ─── Tool Schema ────────────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description?: string;
  properties?: Record<string, ToolParameter>;
  required?: string[];
  items?: ToolParameter;
  enum?: string[];
  default?: unknown;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter;
  /** Capability tier for approval system */
  tier?: 'read' | 'write' | 'exec';
  /** Whether tool is concurrency-safe with other tools */
  concurrencySafe?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error?: boolean;
}

// ─── Model & Provider ──────────────────────────────────────────

export interface Model {
  id: string;
  provider: string;
  displayName?: string;
  contextWindow: number;
  maxOutput?: number;
  supportsThinking?: boolean;
  supportsImages?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

export interface ApiKey {
  key: string;
  provider: string;
  expiresAt?: number;
  refresh?: () => Promise<string>;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  signal?: AbortSignal;
  reasoning?: Effort;
  toolChoice?: ToolChoice;
  tools?: Tool[];
}

export type ToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

// ─── Thinking / Reasoning Effort ────────────────────────────────

export const Effort = {
  Off: 'off',
  Minimal: 'minimal',
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  XHigh: 'xhigh',
} as const;

export type Effort = (typeof Effort)[keyof typeof Effort];

// ─── Stream Events ──────────────────────────────────────────────

export type AssistantMessageEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end'; thinking: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; name: string; key: string; delta: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'usage'; usage: Usage }
  | { type: 'error'; error: string; retryable?: boolean }
  | { type: 'done' };

export type AssistantMessageEventStream = AsyncGenerator<AssistantMessageEvent>;

// ─── Dialect System ────────────────────────────

export type Dialect =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'kimi'
  | 'gemini'
  | 'gemma'
  | 'qwen3'
  | 'glm'
  | 'hermes'
  | 'minimax'
  | 'generic';

export interface DialectDefinition {
  dialect: Dialect;
  /** Render a tool call for this provider's format */
  renderToolCall(call: ToolCall): string;
  /** Render tool results for this provider's format */
  renderToolResults(results: ToolResult[]): string;
  /** Render thinking/reasoning content */
  renderThinking(text: string): string;
  /** Parse streaming events from this provider's format */
  parseStreamChunk(chunk: string): AssistantMessageEvent[];
  /** Build request body with provider-specific fields */
  buildRequestBody(messages: Message[], options: StreamOptions): Record<string, unknown>;
}

// ─── Provider Interface ─────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeys?: string[];
  models?: string[];
  dialect?: Dialect;
  rateLimit?: { requestsPerMinute: number; tokensPerMinute: number };
}

export interface Provider {
  readonly name: string;
  readonly available: boolean;
  readonly dialect: Dialect;
  readonly models: string[];

  chat(messages: Message[], model: string, options?: StreamOptions): Promise<AssistantMessageEvent[]>;
  stream(messages: Message[], model: string, options?: StreamOptions): AssistantMessageEventStream;
  listModels(): Promise<string[]>;
}

// ─── Error Types ────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    public providerName: string,
    public statusCode: number,
    detail: string,
    public retryAfter?: number,
  ) {
    super(`${providerName} API error ${statusCode}: ${detail}`);
    this.name = 'ProviderError';
  }

  get isRetryable() { return this.statusCode === 429 || this.statusCode >= 500; }
  get shouldRotate() { return this.statusCode === 429 || this.statusCode === 401 || this.statusCode === 403; }
  get backoffMs() {
    if (this.retryAfter) return this.retryAfter * 1000;
    if (this.statusCode === 429) return 5000;
    if (this.statusCode >= 500) return 2000;
    return 1000;
  }
}
