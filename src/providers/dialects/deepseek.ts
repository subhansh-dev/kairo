/**
 * Kairo — DeepSeek Dialect
 * Handles DeepSeek's API format (thinking via reasoning_content, tool calling)
 */

import type { DialectDefinition, Message, StreamOptions, ToolCall, ToolResult, AssistantMessageEvent } from '../types.js';

export const deepseekDialect: DialectDefinition = {
  dialect: 'deepseek',

  renderToolCall(call: ToolCall): string {
    return `<tool_call>\n${call.name}(${JSON.stringify(call.arguments)})\n</tool_call>`;
  },

  renderToolResults(results: ToolResult[]): string {
    return results.map(r =>
      `<tool_result name="${r.tool_call_id}">${r.content}</tool_result>`
    ).join('\n');
  },

  renderThinking(text: string): string {
    return `<think>${text}</think>`;
  },

  parseStreamChunk(chunk: string): AssistantMessageEvent[] {
    const events: AssistantMessageEvent[] = [];
    const lines = chunk.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        events.push({ type: 'done' });
        continue;
      }

      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          events.push({ type: 'text', text: delta.content });
        }
        // DeepSeek uses reasoning_content for thinking
        if (delta?.reasoning_content) {
          events.push({ type: 'thinking_delta', delta: delta.reasoning_content });
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              events.push({ type: 'tool_call_start', id: tc.id || '', name: tc.function.name });
            }
            if (tc.function?.arguments) {
              events.push({
                type: 'tool_call_delta',
                id: tc.id || '',
                name: tc.function?.name || '',
                key: 'arguments',
                delta: tc.function.arguments,
              });
            }
          }
        }
        if (parsed.usage) {
          events.push({
            type: 'usage',
            usage: {
              input: parsed.usage.prompt_tokens || 0,
              output: parsed.usage.completion_tokens || 0,
              cacheRead: parsed.usage.cache_read_input_tokens || 0,
              cacheWrite: 0,
              totalTokens: (parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0),
            },
          });
        }
      } catch {}
    }

    return events;
  },

  buildRequestBody(messages: Message[], options: StreamOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n'),
      })),
      stream: true,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.tools) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (options.reasoning && options.reasoning !== 'off') {
      // DeepSeek uses a different thinking param format
      body.enable_thinking = true;
      body.thinking_budget = reasoningBudget(options.reasoning);
    }

    return body;
  },
};

function reasoningBudget(effort: string): number {
  switch (effort) {
    case 'minimal': return 1024;
    case 'low': return 2048;
    case 'medium': return 4096;
    case 'high': return 8192;
    case 'xhigh': return 16384;
    default: return 4096;
  }
}

export default deepseekDialect;
