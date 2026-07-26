/**
 * Kairo — Tool Intent
 * Forces the model to explain WHY it's calling a tool before execution.
 * The intent is extracted, logged, and stripped from the actual tool args.
 * Improves debugging and understanding of model reasoning.
 */

import type { ExtractedToolCall } from './types.js';

export const INTENT_FIELD = '_intent';

export interface IntentAnnotatedCall extends ExtractedToolCall {
  /** Why the model is calling this tool (extracted from args or preceding text) */
  intent?: string;
  /** Tool args with intent stripped */
  cleanArgs: string;
}

/**
 * Extract intent from a tool call.
 * Some providers inject an `intent` field into the tool schema.
 * Kairo uses line-based tool calls, so we extract intent from:
 * 1. A `_intent:` prefix in the args
 * 2. The text immediately before the !tool call
 */
export function extractIntent(call: ExtractedToolCall, precedingText?: string): IntentAnnotatedCall {
  const args = call.args;

  // Method 1: _intent: prefix in args
  const intentMatch = args.match(/^(?:_intent|intent):\s*(.+?)(?:\n|$)/i);
  if (intentMatch) {
    const cleanArgs = args.slice(intentMatch[0].length).trim();
    return {
      ...call,
      intent: intentMatch[1].trim(),
      cleanArgs,
    };
  }

  // Method 2: preceding text ends with intent-like sentence
  if (precedingText) {
    const lines = precedingText.trim().split('\n');
    const lastLine = lines[lines.length - 1]?.trim() || '';
    // If the last line before the tool call looks like an explanation (ends with period/colon)
    if (lastLine.length > 10 && lastLine.length < 200 && /[.:]$/.test(lastLine)) {
      return {
        ...call,
        intent: lastLine,
        cleanArgs: args,
      };
    }
  }

  return { ...call, cleanArgs: args };
}

/**
 * Process a batch of tool calls, extracting intents from preceding text.
 * The text between tool calls is used as context for intent extraction.
 */
export function annotateIntents(
  calls: ExtractedToolCall[],
  fullText: string,
): IntentAnnotatedCall[] {
  const annotated: IntentAnnotatedCall[] = [];
  let lastEnd = 0;

  for (const call of calls) {
    // Find the text before this tool call
    const callIdx = fullText.indexOf(`!${call.name}`, lastEnd);
    const preceding = callIdx > 0 ? fullText.slice(lastEnd, callIdx) : '';
    annotated.push(extractIntent(call, preceding));
    lastEnd = callIdx + call.raw.length;
  }

  return annotated;
}
