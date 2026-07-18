/**
 * Compaction prompt builder — generates the summary prompt for LLM calls.
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
}

export interface CompactionPromptOptions {
  /** The messages to compact */
  messages: ChatMessage[];
  /** Summary of the conversation so far */
  existingSummary?: string;
  /** Agent type for prompt selection */
  agentType?: string;
  /** Include tool calls in the summary */
  includeToolCalls: boolean;
  /** Max tokens for the summary output */
  maxSummaryTokens: number;
}

const COMPACTION_SYSTEM_PROMPT = `You are a conversation compaction assistant. Your job is to create a concise, information-dense summary of the conversation that preserves all critical context needed to continue the conversation.

Rules:
1. Preserve all file paths, function names, variable names, and technical details
2. Preserve all decisions made and their reasoning
3. Preserve all errors encountered and their solutions
4. Preserve the current task state and what remains to be done
5. Preserve any constraints or requirements mentioned
6. Omit pleasantries, greetings, and redundant information
7. Use bullet points for clarity
8. Include relevant code snippets only if they are critical context
9. Always end with "CURRENT STATE:" section describing where we are

Output format:
<summary>
[Your summary here]
</summary>`;

const COMPACTION_SUMMARY_ONLY_PROMPT = `Summarize the following conversation into a dense, information-rich brief. Preserve all technical details, file paths, decisions, errors, and current state. Output only the summary text, no preamble.`;

/**
 * Build the system prompt for compaction.
 */
export function buildCompactionSystemPrompt(): string {
  return COMPACTION_SYSTEM_PROMPT;
}

/**
 * Build the user message for compaction.
 */
export function buildCompactionUserMessage(options: CompactionPromptOptions): string {
  const { messages, existingSummary, includeToolCalls } = options;

  let parts: string[] = [];

  if (existingSummary) {
    parts.push(`EXISTING SUMMARY:\n${existingSummary}\n`);
  }

  parts.push('CONVERSATION TO COMPACT:');
  parts.push('─'.repeat(40));

  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' :
                   msg.role === 'assistant' ? 'Assistant' :
                   msg.role === 'system' ? 'System' :
                   msg.role === 'tool' ? 'Tool Result' : 'Developer';

    if (msg.role === 'tool' && !includeToolCalls) continue;

    if (msg.content) {
      parts.push(`[${prefix}]: ${msg.content}`);
    }

    if (msg.toolCalls && includeToolCalls) {
      for (const tc of msg.toolCalls) {
        parts.push(`[${prefix} Tool Call]: ${tc.function.name}(${truncateArgs(tc.function.arguments)})`);
      }
    }
  }

  parts.push('─'.repeat(40));
  parts.push('Create a comprehensive summary preserving all critical context.');

  return parts.join('\n');
}

/**
 * Build a summary-only prompt (no system prompt, just instructions).
 */
export function buildSummaryOnlyPrompt(messages: ChatMessage[]): string {
  const conversationText = messages
    .map(m => `[${m.role}]: ${m.content ?? ''}`)
    .join('\n');

  return `${COMPACTION_SUMMARY_ONLY_PROMPT}\n\n${conversationText}`;
}

function truncateArgs(args: string, maxLen: number = 500): string {
  if (args.length <= maxLen) return args;
  return args.slice(0, maxLen) + '...';
}
