/**
 * Kairo — Tool Failure Loop Guard
 * Detects when the model gets stuck repeating the same tool failure.
 * Tracks failure signatures, categories, and paths.
 * Trips after N consecutive similar failures and injects a "you're stuck" message.
 */

// ─── Types ─────────────────────────────────────────────────

export interface ToolFailureLoopGuardState {
  /** Signature: toolName + errorCategory + path */
  signatureCounts: Map<string, number>;
  /** Error category (e.g., "permission_denied", "not_found") */
  categoryCounts: Map<string, number>;
  /** File path involved in the failure */
  pathCounts: Map<string, number>;
}

export type ToolFailureLoopDecision =
  | { tripped: false }
  | {
      tripped: true;
      message: string;
      threshold: number;
      kind: 'signature' | 'category' | 'path';
      toolName?: string;
      errorCategory?: string;
      path?: string;
    };

// ─── Defaults ──────────────────────────────────────────────

const DEFAULT_THRESHOLD = 3;

// ─── State Management ──────────────────────────────────────

export function createFailureLoopState(): ToolFailureLoopGuardState {
  return {
    signatureCounts: new Map(),
    categoryCounts: new Map(),
    pathCounts: new Map(),
  };
}

// ─── Classification ────────────────────────────────────────

/**
 * Classify a tool error into a category.
 * Used for grouping similar failures together.
 */
export function classifyToolError(toolName: string, errorOutput: string): string {
  const lower = errorOutput.toLowerCase();

  if (/permission|access denied|eacces|forbidden/i.test(lower)) return 'permission_denied';
  if (/not found|enoent|no such file|does not exist/i.test(lower)) return 'not_found';
  if (/timeout|timed out|deadline exceeded/i.test(lower)) return 'timeout';
  if (/syntax error|parse error|unexpected token/i.test(lower)) return 'syntax_error';
  if (/type error|reference error|is not a function/i.test(lower)) return 'runtime_error';
  if (/connection|econnrefused|enotfound|network/i.test(lower)) return 'network_error';
  if (/rate limit|too many requests|429/i.test(lower)) return 'rate_limited';
  if (/already exists|eexist/i.test(lower)) return 'already_exists';
  if (/command not found|unknown command/i.test(lower)) return 'command_not_found';

  return 'other';
}

/**
 * Extract the primary file path from tool arguments.
 */
export function extractPath(toolName: string, args: string): string | undefined {
  try {
    const parsed = JSON.parse(args);
    if (typeof parsed.path === 'string') return parsed.path;
    if (typeof parsed.file_path === 'string') return parsed.file_path;
    if (typeof parsed.target === 'string') return parsed.target;
  } catch {
    // args might be a plain string (e.g., bash command)
  }
  return undefined;
}

// ─── Guard Logic ───────────────────────────────────────────

/**
 * Update the failure loop guard with a new failure.
 * Returns a decision indicating if the loop was tripped.
 */
export function updateFailureLoopGuard(
  state: ToolFailureLoopGuardState,
  toolName: string,
  errorOutput: string,
  args: string,
  threshold: number = DEFAULT_THRESHOLD,
): ToolFailureLoopDecision {
  if (threshold === 0) return { tripped: false };

  const category = classifyToolError(toolName, errorOutput);
  const path = extractPath(toolName, args);
  const signature = `${toolName}:${category}:${path || 'none'}`;

  // Update counts
  state.signatureCounts.set(signature, (state.signatureCounts.get(signature) || 0) + 1);
  state.categoryCounts.set(category, (state.categoryCounts.get(category) || 0) + 1);
  if (path) {
    state.pathCounts.set(path, (state.pathCounts.get(path) || 0) + 1);
  }

  // Check signature (most specific)
  if ((state.signatureCounts.get(signature) || 0) >= threshold) {
    return {
      tripped: true,
      message: `You're stuck in a loop: "${toolName}" failed ${threshold} times with the same error (${category}) on "${path || 'same input'}". Try a different approach.`,
      threshold,
      kind: 'signature',
      toolName,
      errorCategory: category,
      path,
    };
  }

  // Check category (medium specificity)
  if ((state.categoryCounts.get(category) || 0) >= threshold + 1) {
    return {
      tripped: true,
      message: `You're stuck: ${threshold + 1} "${category}" errors in a row. This approach isn't working — try something different.`,
      threshold,
      kind: 'category',
      errorCategory: category,
    };
  }

  // Check path (broadest)
  if (path && (state.pathCounts.get(path) || 0) >= threshold + 2) {
    return {
      tripped: true,
      message: `You're stuck: ${threshold + 2} failures on "${path}". Stop trying this file and try a different approach.`,
      threshold,
      kind: 'path',
      path,
    };
  }

  return { tripped: false };
}

/**
 * Reset the guard state (e.g., after a successful tool call).
 */
export function resetFailureLoopGuard(state: ToolFailureLoopGuardState): void {
  state.signatureCounts.clear();
  state.categoryCounts.clear();
  state.pathCounts.clear();
}
