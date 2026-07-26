/**
 * Debug helpers — debugging utilities for the agent.
 */

export interface DebugInfo {
  sessionId?: string;
  turnNumber?: number;
  toolCalls: number;
  errors: number;
  duration: number;
  model?: string;
  provider?: string;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
}

/**
 * Collect debug information about the current state.
 */
export function collectDebugInfo(opts: {
  sessionId?: string;
  turnNumber?: number;
  toolCalls?: number;
  errors?: number;
  startTime?: number;
  model?: string;
  provider?: string;
} = {}): DebugInfo {
  return {
    sessionId: opts.sessionId,
    turnNumber: opts.turnNumber,
    toolCalls: opts.toolCalls || 0,
    errors: opts.errors || 0,
    duration: opts.startTime ? Date.now() - opts.startTime : 0,
    model: opts.model,
    provider: opts.provider,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
  };
}

/**
 * Format debug info for display.
 */
export function formatDebugInfo(info: DebugInfo): string {
  const lines = [
    `Session: ${info.sessionId || 'none'}`,
    `Turn: ${info.turnNumber || 0}`,
    `Tools: ${info.toolCalls} (${info.errors} errors)`,
    `Duration: ${(info.duration / 1000).toFixed(1)}s`,
    `Model: ${info.provider || '?'}/${info.model || '?'}`,
    `Memory: ${Math.round(info.memoryUsage.heapUsed / 1024 / 1024)}MB heap`,
    `Uptime: ${(info.uptime / 60).toFixed(1)}m`,
  ];
  return lines.join(' | ');
}

/**
 * Get a stack trace (for debugging).
 */
export function getStackTrace(skip = 0): string {
  const err = new Error();
  const stack = err.stack || '';
  const lines = stack.split('\n').slice(2 + skip);
  return lines.join('\n');
}

/**
 * Measure execution time of an async function.
 */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

/**
 * Measure execution time of a sync function.
 */
export function measureTimeSync<T>(fn: () => T): { result: T; durationMs: number } {
  const start = Date.now();
  const result = fn();
  return { result, durationMs: Date.now() - start };
}
