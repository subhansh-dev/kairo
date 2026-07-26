/**
 * Kairo — Gemini Dialect
 * Handles Google Gemini's API format
 */

import type { DialectDefinition, Message, StreamOptions, ToolCall, ToolResult, AssistantMessageEvent } from '../types.js';

export const geminiDialect: DialectDefinition = {
  dialect: 'gemini',

  renderToolCall(call: ToolCall): string {
    return `\`\`\`tool_code\ndefault_api.${call.name}(${Object.entries(call.arguments).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})\n\`\`\``;
  },

  renderToolResults(results: ToolResult[]): string {
    return results.map(r => `\`\`\`tool_output\n${r.content}\n\`\`\``).join('\n');
  },

  renderThinking(text: string): string {
    return `\`\`\`thinking\n${text}\n\`\`\``;
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
        const candidate = parsed.candidates?.[0];
        if (!candidate) continue;

        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.text) {
            events.push({ type: 'text', text: part.text });
          }
          if (part.functionCall) {
            events.push({
              type: 'tool_call_end',
              id: '',
              name: part.functionCall.name,
              arguments: part.functionCall.args || {},
            });
          }
          if (part.thought) {
            events.push({ type: 'thinking_delta', delta: part.thought });
          }
        }

        if (parsed.usageMetadata) {
          events.push({
            type: 'usage',
            usage: {
              input: parsed.usageMetadata.promptTokenCount || 0,
              output: parsed.usageMetadata.candidatesTokenCount || 0,
              cacheRead: parsed.usageMetadata.cachedContentTokenCount || 0,
              cacheWrite: 0,
              totalTokens: (parsed.usageMetadata.promptTokenCount || 0) + (parsed.usageMetadata.candidatesTokenCount || 0),
            },
          });
        }
      } catch {}
    }

    return events;
  },

  buildRequestBody(messages: Message[], options: StreamOptions): Record<string, unknown> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      contents: nonSystem.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n') }],
      })),
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens || 8192,
      },
    };

    if (systemMsg) {
      body.systemInstruction = {
        parts: [{ text: typeof systemMsg.content === 'string' ? systemMsg.content : '' }],
      };
    }

    if (options.tools) {
      body.tools = [{
        functionDeclarations: options.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    return body;
  },
};

export default geminiDialect;
