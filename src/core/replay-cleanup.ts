/**
 * Replay-history sanitization for session resume.
 *
 * When a session dies mid-tool-loop, the persisted transcript can end with
 * dangling tool calls. On resume, the model sees that broken tail and
 * re-issues the unanswered call. These helpers strip those tails.
 */

export interface HistoryMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{
    id?: string;
    call_id?: string;
    function?: { name?: string };
    name?: string;
  }>;
  tool_call_id?: string;
  [key: string]: unknown;
}

/**
 * Check if a tool result indicates the tool was interrupted.
 */
export function isInterruptedToolResult(content: unknown): boolean {
  if (typeof content !== 'string') return false;
  const lower = content.toLowerCase();
  if (lower.includes('[command interrupted]')) return true;
  if (lower.includes('exit_code') && (lower.includes('130') || lower.includes('-1'))) {
    return lower.includes('interrupt');
  }
  return false;
}

/**
 * Strip interrupted assistant→tool sequences from replay history.
 * Removes any contiguous assistant(tool_calls) + tool-result block
 * that contains an interrupted tool result.
 */
export function stripInterruptedToolTails(history: HistoryMessage[]): HistoryMessage[] {
  if (!history.length) return history;

  const cleaned: HistoryMessage[] = [];
  let i = 0;

  while (i < history.length) {
    const msg = history[i];

    if (msg.role === 'assistant' && msg.tool_calls) {
      // Collect following tool results
      let j = i + 1;
      const toolResults: HistoryMessage[] = [];
      while (j < history.length && history[j].role === 'tool') {
        toolResults.push(history[j]);
        j++;
      }

      if (toolResults.length > 0 && toolResults.some(m => isInterruptedToolResult(m.content))) {
        // Has interrupted results — strip or mark
        const hasSideEffects = msg.tool_calls.some(tc => {
          const name = tc.function?.name || tc.name || '';
          return !['read', 'grep', 'glob', 'ls', 'web_fetch', 'web_search'].includes(name);
        });

        if (hasSideEffects) {
          // Keep the assistant message, mark interrupted results
          cleaned.push(msg);
          for (const result of toolResults) {
            if (!isInterruptedToolResult(result.content)) {
              cleaned.push(result);
            } else {
              cleaned.push({
                ...result,
                content: '[Orphan recovery: interrupted tool may have executed; inspect state before retrying.]',
              });
            }
          }
          i = j;
          continue;
        }

        // Read-only interrupted — strip entirely
        i = j;
        continue;
      }
    }

    // Strip orphan interrupted tool results
    if (msg.role === 'tool' && isInterruptedToolResult(msg.content)) {
      i++;
      continue;
    }

    cleaned.push(msg);
    i++;
  }

  return cleaned;
}

/**
 * Strip a trailing assistant(tool_calls) block with NO matching tool results.
 * Prevents infinite reboot loops on resume.
 */
export function stripDanglingToolCallTail(history: HistoryMessage[]): HistoryMessage[] {
  if (!history.length) return history;

  const last = history[history.length - 1];
  if (last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
    // Check if there are any tool results after this assistant message
    // (there shouldn't be if it's the last message)
    const hasMatchingResults = history.some(
      (msg, idx) => idx > history.length - 1 - (last.tool_calls?.length || 0) && msg.role === 'tool'
    );
    if (!hasMatchingResults) {
      return history.slice(0, -1);
    }
  }

  return history;
}

/**
 * Full cleanup: strip both interrupted tails and dangling tool calls.
 */
export function cleanReplayHistory(history: HistoryMessage[]): HistoryMessage[] {
  let cleaned = stripInterruptedToolTails(history);
  cleaned = stripDanglingToolCallTail(cleaned);
  return cleaned;
}
