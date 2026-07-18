/**
 * Hub channel — notification extraction from server frames.
 *
 */

import { WORKSPACE_EVENTS_TOOL_ID, WORKSPACE_RPC_TOOL_ID } from './hub_ids';

export interface ToolNotificationFrame {
  toolCallId?: string;
  toolId?: string;
  notification: WireToolNotification;
}

export type WireToolNotification =
  | { type: 'custom'; kind: string; payload: any }
  | { type: 'known'; payload: any };

export interface WorkspaceEvent {
  type: 'tools_changed';
  sessionId: string;
}

/**
 * Extract a WorkspaceEvent from a custom ToolNotificationFrame.
 */
export function extractWorkspaceEvent(
  frame: ToolNotificationFrame
): WorkspaceEvent | null {
  if (frame.notification.type !== 'custom') return null;
  if (frame.notification.kind !== 'workspace_event') return null;

  try {
    const payload = frame.notification.payload;
    if (payload && typeof payload === 'object' && payload.type === 'tools_changed') {
      return {
        type: 'tools_changed',
        sessionId: payload.session_id || payload.sessionId || '',
      };
    }
  } catch {
    // Invalid payload
  }

  return null;
}

/**
 * Extract a ToolNotification from a custom ToolNotificationFrame.
 */
export function extractToolNotification(
  frame: ToolNotificationFrame
): ToolNotification | null {
  if (frame.notification.type !== 'custom') return null;

  try {
    return frame.notification.payload as ToolNotification;
  } catch {
    return null;
  }
}

export interface ToolNotification {
  type: string;
  [key: string]: any;
}

/**
 * Consume a stream of tool results, collecting output until terminal.
 */
export async function consumeStreamTerminal(
  stream: AsyncIterable<any>
): Promise<{ output: string; error?: string }> {
  let output = '';
  let error: string | undefined;

  for await (const chunk of stream) {
    if (chunk.type === 'text') {
      output += chunk.text || '';
    } else if (chunk.type === 'error') {
      error = chunk.message || chunk.text || 'Unknown error';
    }
  }

  return { output, error };
}
