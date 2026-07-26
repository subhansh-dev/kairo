/**
 * Tool backend helpers — tool execution backend utilities.
 */

export interface ToolExecutionContext {
  toolName: string;
  args: Record<string, unknown>;
  sessionId?: string;
  turnId?: string;
  cwd: string;
  timeout?: number;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  exitCode?: number;
}

/**
 * Build tool execution context.
 */
export function buildToolContext(opts: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    toolName: opts.toolName || 'unknown',
    args: opts.args || {},
    sessionId: opts.sessionId,
    turnId: opts.turnId,
    cwd: opts.cwd || process.cwd(),
    timeout: opts.timeout || 30000,
  };
}

/**
 * Format tool execution result for display.
 */
export function formatToolResult(result: ToolExecutionResult): string {
  const icon = result.success ? '✅' : '❌';
  const duration = `(${result.durationMs}ms)`;
  const output = result.output.length > 200 ? result.output.slice(0, 200) + '…' : result.output;
  return `${icon} ${duration} ${output}`;
}

/**
 * Check if a tool result indicates success.
 */
export function isToolSuccess(result: ToolExecutionResult): boolean {
  return result.success;
}

/**
 * Get a summary of tool execution results.
 */
export function summarizeToolResults(results: ToolExecutionResult[]): { total: number; success: number; failed: number; totalDurationMs: number } {
  return {
    total: results.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
  };
}
