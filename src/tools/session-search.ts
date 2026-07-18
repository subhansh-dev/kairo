import type { ToolDefinition, ToolResult } from './types.js';
import { searchSessions, browseSessions, formatSearchResult } from '../session/search.js';

export const sessionSearchTool: ToolDefinition = {
  name: 'session_search',
  description: 'Search past conversation sessions. Usage: session_search <query> | session_search --browse | session_search --scroll <session_id> <msg_index>',
  prompt: `Search across past conversation sessions or browse recent sessions.

Modes (auto-detected from args):
  - <query> — search all sessions for text match, returns top 5 results with context snippets
  - --browse — list recent sessions with titles, message counts, and previews
  - --scroll <session_id> <msg_index> — get a window of messages around an anchor point

No LLM call needed — searches the JSON session store directly.`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const trimmed = args.trim();

      // Browse mode
      if (trimmed === '--browse') {
        const result = browseSessions();
        return {
          output: formatSearchResult(result),
          success: true,
          metadata: { mode: 'browse', count: result.sessions?.length || 0 },
        };
      }

      // Scroll mode
      const scrollMatch = trimmed.match(/^--scroll\s+(\S+)\s+(\d+)$/);
      if (scrollMatch) {
        const { getScrollWindow } = await import('../session/search.js');
        const result = getScrollWindow(scrollMatch[1], parseInt(scrollMatch[2]));
        return {
          output: formatSearchResult(result),
          success: !result.error,
          metadata: { mode: 'scroll', sessionId: scrollMatch[1], anchorIndex: parseInt(scrollMatch[2]) },
        };
      }

      // Discovery mode (default)
      if (trimmed.length === 0) {
        return { output: 'Usage: session_search <query> | --browse | --scroll <id> <idx>', success: false };
      }

      const result = searchSessions(trimmed);
      return {
        output: formatSearchResult(result),
        success: true,
        metadata: { mode: 'discovery', query: trimmed, count: result.hits?.length || 0 },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
