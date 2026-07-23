/**
 * Kairo — Anthropic Dialect
 * Handles Anthropic's Messages API format:
 *   - System prompt as top-level `system` field (not a system message)
 *   - Content blocks: [{type:"text",text:"..."}] instead of plain strings
 *   - Tool calls: [{type:"tool_use",id:"...",name:"...",input:{...}}]
 *   - Tool results: [{type:"tool_result",tool_use_id:"...",content:"..."}]
 *   - Streaming SSE with typed events (message_start, content_block_start/delta/stop, message_delta/stop)
 */

import type {
  DialectDefinition,
  Message,
  StreamOptions,
  ToolCall,
  ToolResult,
  AssistantMessageEvent,
  ContentBlock,
  TextContent,
  ToolCallContent,
  ToolResultContent,
  ThinkingContent,
  ImageContent,
  Tool,
} from '../types.js';

// ─── Tool-use tracker for cross-chunk state ──────────────────────
// Anthropic's content_block_delta for input_json_delta only contains an index
// and partial_json — no id/name. We need to remember the id/name from the
// preceding content_block_start to emit correct tool_call_delta events.
// This tracker is scoped per-content-block-index and reset on content_block_stop.
const toolUseTracker: Map<number, { id: string; name: string }> = new Map();

export const anthropicDialect: DialectDefinition = {
  dialect: 'anthropic',

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

  // ─── Anthropic SSE Stream Parsing ───────────────────────────────
  //
  // Anthropic SSE format uses typed events:
  //   event: message_start       → data contains message metadata + usage
  //   event: content_block_start → data contains content_block with type, id, name (for tool_use)
  //   event: content_block_delta → data contains delta (text_delta, input_json_delta, thinking_delta)
  //   event: content_block_stop  → signals end of a content block
  //   event: message_delta       → contains stop_reason + final usage
  //   event: message_stop        → signals end of the message
  //   event: ping                → heartbeat, ignore
  //
  // The `data:` JSON always includes a `type` field matching the event name,
  // so we can parse solely from data lines without tracking event: lines.

  parseStreamChunk(chunk: string): AssistantMessageEvent[] {
    const events: AssistantMessageEvent[] = [];
    const lines = chunk.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip event: lines — the type is embedded in the data JSON
      if (trimmed.startsWith('event: ')) continue;

      // Only process data: lines
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);

      try {
        const parsed = JSON.parse(data);
        const eventType = parsed.type;

        switch (eventType) {
          // ── message_start ──────────────────────────────────────
          case 'message_start': {
            const msg = parsed.message;
            if (msg?.usage) {
              events.push({
                type: 'usage',
                usage: {
                  input: msg.usage.input_tokens || 0,
                  output: msg.usage.output_tokens || 0,
                  cacheRead: msg.usage.cache_read_input_tokens || 0,
                  cacheWrite: msg.usage.cache_creation_input_tokens || 0,
                  totalTokens:
                    (msg.usage.input_tokens || 0) +
                    (msg.usage.output_tokens || 0),
                },
              });
            }
            break;
          }

          // ── content_block_start ────────────────────────────────
          case 'content_block_start': {
            const block = parsed.content_block;
            const idx: number = parsed.index ?? 0;

            if (block?.type === 'text') {
              // Anthropic may include initial text in the start event
              if (block.text) {
                events.push({ type: 'text', text: block.text });
              }
            } else if (block?.type === 'tool_use') {
              // Register tool_use context for subsequent deltas
              toolUseTracker.set(idx, {
                id: block.id || '',
                name: block.name || '',
              });
              events.push({
                type: 'tool_call_start',
                id: block.id || '',
                name: block.name || '',
              });
            } else if (block?.type === 'thinking') {
              events.push({ type: 'thinking_start' });
              if (block.thinking) {
                events.push({ type: 'thinking_delta', delta: block.thinking });
              }
            }
            break;
          }

          // ── content_block_delta ─────────────────────────────────
          case 'content_block_delta': {
            const delta = parsed.delta;
            const idx: number = parsed.index ?? 0;

            if (delta?.type === 'text_delta') {
              events.push({ type: 'text', text: delta.text });
            } else if (delta?.type === 'input_json_delta') {
              // Retrieve id/name from the tracker set during content_block_start
              const toolInfo = toolUseTracker.get(idx);
              events.push({
                type: 'tool_call_delta',
                id: toolInfo?.id || '',
                name: toolInfo?.name || '',
                key: 'arguments',
                delta: delta.partial_json || '',
              });
            } else if (delta?.type === 'thinking_delta') {
              events.push({ type: 'thinking_delta', delta: delta.thinking });
            }
            break;
          }

          // ── content_block_stop ──────────────────────────────────
          case 'content_block_stop': {
            const idx: number = parsed.index ?? 0;
            // If this was a tool_use block, finalize it and clean up tracker
            const toolInfo = toolUseTracker.get(idx);
            if (toolInfo) {
              events.push({
                type: 'tool_call_end',
                id: toolInfo.id,
                name: toolInfo.name,
                arguments: {}, // arguments are accumulated upstream from tool_call_delta events
              });
              toolUseTracker.delete(idx);
            }
            // Note: for thinking blocks, the thinking_end event is emitted
            // by the upstream stream consumer once it accumulates all thinking deltas
            break;
          }

          // ── message_delta ───────────────────────────────────────
          case 'message_delta': {
            const delta = parsed.delta;
            // Emit final usage if present (Anthropic sends output_tokens here)
            if (parsed.usage) {
              events.push({
                type: 'usage',
                usage: {
                  input: 0, // input tokens already reported in message_start
                  output: parsed.usage.output_tokens || 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: parsed.usage.output_tokens || 0,
                },
              });
            }
            // If stop_reason indicates the message is complete, emit done
            if (delta?.stop_reason === 'end_turn' || delta?.stop_reason === 'stop_sequence' || delta?.stop_reason === 'max_tokens') {
              // The actual 'done' event will come from message_stop
            }
            break;
          }

          // ── message_stop ────────────────────────────────────────
          case 'message_stop': {
            events.push({ type: 'done' });
            break;
          }

          // ── ping ────────────────────────────────────────────────
          case 'ping': {
            // Ignore heartbeat events
            break;
          }

          // ── error ───────────────────────────────────────────────
          case 'error': {
            events.push({
              type: 'error',
              error: parsed.error?.message || parsed.message || 'Unknown Anthropic error',
            });
            break;
          }
        }
      } catch {
        // Skip malformed/incomplete JSON — will be retried on next buffer accumulation
      }
    }

    return events;
  },

  // ─── Anthropic Request Body Builder ─────────────────────────────
  //
  // Key differences from OpenAI:
  //   1. System prompt → top-level `system` string field (extracted from system messages)
  //   2. Content is always an array of content blocks, never a plain string
  //   3. Tool role → user role with tool_result content blocks
  //   4. Assistant tool calls → tool_use content blocks (not function_call)
  //   5. Tools → `input_schema` instead of `parameters`
  //   6. tool_choice → {type:"auto"/"any"/"tool", name:"..."}
  //   7. Extended thinking → top-level `thinking` field
  //   8. Stop sequences → `stop_sequences` instead of `stop`

  buildRequestBody(messages: Message[], options: StreamOptions): Record<string, unknown> {
    // Step 1: Extract system messages to top-level `system` field
    const systemParts: string[] = [];
    const nonSystemMessages: Message[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        const text =
          typeof m.content === 'string'
            ? m.content
            : extractTextBlocks(m.content);
        if (text) systemParts.push(text);
      } else {
        nonSystemMessages.push(m);
      }
    }

    const systemText = systemParts.join('\n\n');

    // Step 2: Convert non-system messages to Anthropic format
    const anthropicMessages = convertMessagesToAnthropic(nonSystemMessages);

    // Step 3: Build the request body
    const body: Record<string, unknown> = {
      messages: anthropicMessages,
      stream: true,
    };

    if (systemText) body.system = systemText;
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.topP) body.top_p = options.topP;
    if (options.stop) body.stop_sequences = options.stop;

    // Anthropic requires max_tokens; set a reasonable default if not provided
    if (!options.maxTokens) body.max_tokens = 4096;

    // Tools in Anthropic format: {name, description, input_schema}
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t: Tool) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    // Tool choice in Anthropic format
    if (options.toolChoice) {
      if (options.toolChoice === 'auto') {
        body.tool_choice = { type: 'auto' };
      } else if (options.toolChoice === 'required') {
        body.tool_choice = { type: 'any' }; // Anthropic uses 'any' for "must use a tool"
      } else if (options.toolChoice === 'none') {
        // Anthropic doesn't natively support tool_choice=none;
        // omit tool_choice and don't include tools to achieve the same effect
        // But if the caller explicitly requests it, we pass it anyway
        // (some recent Anthropic API versions support { type: 'none' })
        body.tool_choice = { type: 'none' as string };
      } else if (
        typeof options.toolChoice === 'object' &&
        options.toolChoice.type === 'function'
      ) {
        body.tool_choice = {
          type: 'tool',
          name: options.toolChoice.function.name,
        };
      }
    }

    // Extended thinking support
    if (options.reasoning && options.reasoning !== 'off') {
      body.thinking = {
        type: 'enabled',
        budget_tokens: reasoningBudget(options.reasoning),
      };
    }

    return body;
  },
};

// ─── Helper Functions ────────────────────────────────────────────

/** Extract text from content blocks array, joining all text blocks */
function extractTextBlocks(content: ContentBlock[]): string {
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('\n');
}

/** Convert Kairo Message[] to Anthropic-format message array */
function convertMessagesToAnthropic(messages: Message[]): any[] {
  const result: any[] = [];

  for (const m of messages) {
    switch (m.role) {
      case 'user': {
        result.push({
          role: 'user',
          content: toAnthropicContent(m, 'user'),
        });
        break;
      }

      case 'assistant': {
        const content = toAnthropicContent(m, 'assistant');
        if (content.length > 0) {
          result.push({ role: 'assistant', content });
        }
        break;
      }

      case 'tool': {
        // Anthropic has no "tool" role.
        // Tool results are sent as user messages with tool_result content blocks.
        const toolResultBlocks = toAnthropicToolResults(m);
        if (toolResultBlocks.length > 0) {
          result.push({ role: 'user', content: toolResultBlocks });
        }
        break;
      }

      // system messages are handled separately (extracted to top-level `system` field)
      default:
        break;
    }
  }

  return result;
}

/** Convert a Message's content to Anthropic content blocks array */
function toAnthropicContent(m: Message, role: 'user' | 'assistant'): any[] {
  if (typeof m.content === 'string') {
    // Anthropic requires content as an array of blocks, not a plain string
    if (m.content) {
      return [{ type: 'text', text: m.content }];
    }
    // Empty string → Anthropic requires at least one block for user messages
    if (role === 'user') {
      return [{ type: 'text', text: '' }];
    }
    // For assistant, empty content is allowed (e.g., when only tool_use blocks follow)
    return [];
  }

  // ContentBlock[] → convert each block to Anthropic format
  const blocks: any[] = [];
  for (const block of m.content) {
    switch (block.type) {
      case 'text': {
        const tb = block as TextContent;
        if (tb.text) blocks.push({ type: 'text', text: tb.text });
        break;
      }
      case 'image': {
        const ib = block as ImageContent;
        blocks.push({ type: 'image', source: ib.source });
        break;
      }
      case 'tool_call': {
        const tc = block as ToolCallContent;
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
        break;
      }
      case 'tool_result': {
        const tr = block as ToolResultContent;
        blocks.push({
          type: 'tool_result',
          tool_use_id: tr.tool_call_id,
          content: tr.content,
          is_error: tr.is_error || false,
        });
        break;
      }
      case 'thinking': {
        const th = block as ThinkingContent;
        blocks.push({
          type: 'thinking',
          thinking: th.thinking,
          ...(th.signature ? { signature: th.signature } : {}),
        });
        break;
      }
    }
  }
  return blocks;
}

/** Convert a tool-role Message to Anthropic tool_result content blocks */
function toAnthropicToolResults(m: Message): any[] {
  if (typeof m.content === 'string') {
    // Tool role with string content — need tool_call_id from message metadata
    // (The Message type doesn't natively carry tool_call_id, but upstream may
    //  attach it. We check for common patterns.)
    const toolCallId = (m as any).tool_call_id || '';
    return [
      {
        type: 'tool_result',
        tool_use_id: toolCallId,
        content: m.content,
      },
    ];
  }

  // ContentBlock[] — extract tool_result blocks and convert
  return m.content
    .filter((c): c is ToolResultContent => c.type === 'tool_result')
    .map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.tool_call_id,
      content: tr.content,
      is_error: tr.is_error || false,
    }));
}

/** Map reasoning effort levels to Anthropic budget_tokens values */
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

export default anthropicDialect;
