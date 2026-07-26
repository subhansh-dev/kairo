/**
 * Kairo — OpenAI Dialect
 * Handles OpenAI-compatible APIs (NVIDIA NIM, Groq, Cerebras, OpenRouter)
 */

import type { DialectDefinition, Message, StreamOptions, ToolCall, ToolResult, AssistantMessageEvent } from '../types.js';

export const openaiDialect: DialectDefinition = {
  dialect: 'openai',

  renderToolCall(call: ToolCall): string {
    return JSON.stringify({ name: call.name, arguments: call.arguments });
  },

  renderToolResults(results: ToolResult[]): string {
    return results.map(r =>
      `<tool_result tool_call_id="${r.tool_call_id}">${r.is_error ? '<error>' : ''}${r.content}${r.is_error ? '</error>' : ''}</tool_result>`
    ).join('\n');
  },

  renderThinking(text: string): string {
    return `<thinking>${text}</thinking>`;
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
        if (delta?.reasoning_content) {
          events.push({ type: 'thinking_delta', delta: delta.reasoning_content });
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            // The OpenAI SSE format sends tool calls as deltas:
            // First chunk: { index: 0, id: "call_abc", function: { name: "web_search", arguments: "" } }
            // Subsequent: { index: 0, function: { arguments: "{\"qu" } }
            // The `id` is ONLY in the first chunk. Subsequent chunks only have `index`.
            // We use `index` to generate a stable ID so the accumulator can match them.
            const stableId = tc.id || (tc.index !== undefined ? `tool_call_${tc.index}` : '');
            if (tc.function?.name) {
              events.push({ type: 'tool_call_start', id: stableId, name: tc.function.name });
            }
            if (tc.function?.arguments) {
              events.push({
                type: 'tool_call_delta',
                id: stableId,
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
              cacheWrite: parsed.usage.cache_creation_input_tokens || 0,
              totalTokens: (parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0),
            },
          });
        }
      } catch {
        // Skip malformed JSON
      }
    }

    return events;
  },

  buildRequestBody(messages: Message[], options: StreamOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      messages: messages.map(m => {
        const msg: any = {
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n'),
        };
        // Include tool_call_id for tool role messages
        if (m.role === 'tool' && (m as any).tool_call_id) {
          msg.tool_call_id = (m as any).tool_call_id;
        }
        // Include tool_calls for assistant messages that requested tools
        if (m.role === 'assistant' && (m as any).tool_calls) {
          msg.tool_calls = (m as any).tool_calls;
        }
        return msg;
      }),
      stream: true,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.topP) body.top_p = options.topP;
    if (options.stop) body.stop = options.stop;
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
    if (options.toolChoice) body.tool_choice = options.toolChoice;
    if (options.reasoning && options.reasoning !== 'off') {
      body.extra_body = { thinking: { type: 'enabled', budget: reasoningBudget(options.reasoning) } };
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

export default openaiDialect;
