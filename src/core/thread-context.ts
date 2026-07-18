/**
 * Thread context — propagate context across threads.
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface ThreadContext {
  sessionId?: string;
  turnId?: string;
  agentId?: string;
  parentId?: string;
}

const threadStorage = new AsyncLocalStorage<ThreadContext>();

/**
 * Set the thread context for the current async scope.
 */
export function setThreadContext(context: ThreadContext): void {
  // In Node.js with AsyncLocalStorage, this is set via run()
}

/**
 * Get the current thread context.
 */
export function getThreadContext(): ThreadContext | undefined {
  return threadStorage.getStore();
}

/**
 * Run a function with a specific thread context.
 */
export function withThreadContext<T>(context: ThreadContext, fn: () => T): T {
  return threadStorage.run(context, fn);
}

/**
 * Run an async function with a specific thread context.
 */
export async function withThreadContextAsync<T>(context: ThreadContext, fn: () => Promise<T>): Promise<T> {
  return threadStorage.run(context, fn);
}

/**
 * Get the current session ID from thread context.
 */
export function getSessionId(): string | undefined {
  return getThreadContext()?.sessionId;
}

/**
 * Get the current turn ID from thread context.
 */
export function getTurnId(): string | undefined {
  return getThreadContext()?.turnId;
}

/**
 * Get the current agent ID from thread context.
 */
export function getAgentId(): string | undefined {
  return getThreadContext()?.agentId;
}
