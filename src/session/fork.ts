/**
 * Kairo — Session Forking
 * Fork a session to explore alternative approaches.
 * Like git branches for conversations.
 */

import type { ChatMessage } from '../providers/registry.js';

export interface SessionFork {
  id: string;
  parentId: string;
  label: string;
  messages: ChatMessage[];
  createdAt: number;
  branchPoint: number; // message index where fork happened
}

const forks = new Map<string, SessionFork>();

/**
 * Fork the current session at a specific message index.
 * Creates a copy of the conversation up to that point.
 */
export function forkSession(
  parentId: string,
  messages: ChatMessage[],
  branchPoint: number,
  label?: string,
): SessionFork {
  const id = `fork_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const fork: SessionFork = {
    id,
    parentId,
    label: label || `Fork at message ${branchPoint}`,
    messages: [...messages],
    createdAt: Date.now(),
    branchPoint,
  };
  forks.set(id, fork);
  return fork;
}

/**
 * Get a fork by ID.
 */
export function getFork(id: string): SessionFork | undefined {
  return forks.get(id);
}

/**
 * List all forks for a parent session.
 */
export function listForks(parentId: string): SessionFork[] {
  return [...forks.values()].filter(f => f.parentId === parentId);
}

/**
 * Delete a fork.
 */
export function deleteFork(id: string): boolean {
  return forks.delete(id);
}

/**
 * Merge a fork's messages back into the parent.
 * Returns the messages to append to the parent.
 */
export function mergeFork(forkId: string): ChatMessage[] | null {
  const fork = forks.get(forkId);
  if (!fork) return null;
  // Return messages after the branch point
  return fork.messages.slice(fork.branchPoint + 1);
}

/**
 * Format fork list for display.
 */
export function formatForkList(parentId: string): string {
  const sessionForks = listForks(parentId);
  if (sessionForks.length === 0) return 'No forks.';

  return sessionForks
    .map((f, i) => {
      const age = Math.round((Date.now() - f.createdAt) / 60000);
      return `  ${i + 1}. ${f.label} (${f.messages.length} msgs, ${age}m ago) [${f.id}]`;
    })
    .join('\n');
}
