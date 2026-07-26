/**
 * Session recap — summarize a session.
 */

export interface SessionRecap {
  summary: string;
  keyDecisions: string[];
  filesModified: string[];
  toolsUsed: string[];
  duration: number;
  messageCount: number;
  toolCallCount: number;
}

/**
 * Generate a recap of a session.
 */
export function generateSessionRecap(messages: Array<{ role: string; content: string }>): SessionRecap {
  const keyDecisions: string[] = [];
  const filesModified: string[] = [];
  const toolsUsed: string[] = [];
  let toolCallCount = 0;

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      // Extract file mentions
      const fileMatches = msg.content.match(/(?:\/[\w.-]+)+\.\w+/g);
      if (fileMatches) {
        for (const f of fileMatches) {
          if (!filesModified.includes(f)) filesModified.push(f);
        }
      }

      // Extract decision indicators
      const decisionPatterns = [
        /(?:decided|chose|picked|going with|will use)\s+(.{10,50})/gi,
        /(?:decision|choice):\s*(.{10,80})/gi,
      ];
      for (const pattern of decisionPatterns) {
        const matches = msg.content.matchAll(pattern);
        for (const match of matches) {
          keyDecisions.push(match[1].trim());
        }
      }
    }

    if (msg.role === 'tool') {
      toolCallCount++;
    }
  }

  // Generate summary
  const userMessages = messages.filter(m => m.role === 'user');
  const summary = userMessages.length > 0
    ? `Session focused on: ${userMessages[0].content.slice(0, 100)}${userMessages[0].content.length > 100 ? '…' : ''}`
    : 'Empty session';

  return {
    summary,
    keyDecisions: keyDecisions.slice(0, 5),
    filesModified: filesModified.slice(0, 10),
    toolsUsed: [...new Set(toolsUsed)].slice(0, 10),
    duration: 0, // Would need timestamps
    messageCount: messages.length,
    toolCallCount,
  };
}

/**
 * Format a session recap for display.
 */
export function formatSessionRecap(recap: SessionRecap): string {
  const lines = [recap.summary, ''];

  if (recap.keyDecisions.length > 0) {
    lines.push('Key decisions:');
    for (const d of recap.keyDecisions) {
      lines.push(`  • ${d}`);
    }
    lines.push('');
  }

  if (recap.filesModified.length > 0) {
    lines.push(`Files modified (${recap.filesModified.length}):`);
    for (const f of recap.filesModified.slice(0, 5)) {
      lines.push(`  • ${f}`);
    }
    if (recap.filesModified.length > 5) {
      lines.push(`  ... and ${recap.filesModified.length - 5} more`);
    }
    lines.push('');
  }

  lines.push(`${recap.messageCount} messages, ${recap.toolCallCount} tool calls`);

  return lines.join('\n');
}
