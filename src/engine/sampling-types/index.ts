/**
 * Sampling types — types for LLM sampling and conversation management.
 */

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'developer';

export interface SamplingMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface SamplingParams {
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  topK?: number;
  stop?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface SamplingResult {
  message: SamplingMessage;
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Detect doom loops in a conversation (repeated patterns).
 */
export function detectDoomLoop(
  messages: SamplingMessage[],
  windowSize: number = 5,
  similarityThreshold: number = 0.8,
): { isDoomLoop: boolean; pattern?: string } {
  if (messages.length < windowSize * 2) return { isDoomLoop: false };

  const recent = messages.slice(-windowSize);
  const previous = messages.slice(-windowSize * 2, -windowSize);

  // Simple similarity check: compare content of assistant messages
  const recentContent = recent
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join('\n');

  const previousContent = previous
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join('\n');

  if (!recentContent || !previousContent) return { isDoomLoop: false };

  const similarity = computeSimilarity(recentContent, previousContent);

  return {
    isDoomLoop: similarity >= similarityThreshold,
    pattern: similarity >= similarityThreshold ? recentContent.slice(0, 200) : undefined,
  };
}

function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const aWords = new Set(a.toLowerCase().split(/\s+/));
  const bWords = new Set(b.toLowerCase().split(/\s+/));

  let intersection = 0;
  for (const word of aWords) {
    if (bWords.has(word)) intersection++;
  }

  const union = new Set([...aWords, ...bWords]).size;
  return union === 0 ? 0 : intersection / union;
}
