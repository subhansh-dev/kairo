/**
 * Kairo — Auto-Fix
 * After file edits (write/edit tools), automatically runs lint/test
 * and feeds errors back to the model for immediate correction.
 * Prevents the model from leaving broken code behind.
 */

// ─── Types ─────────────────────────────────────────────────

export interface AutoFixConfig {
  enabled: boolean;
  /** Lint command to run after file edits (e.g., "npx tsc --noEmit") */
  lint?: string;
  /** Test command to run after file edits (e.g., "npm test") */
  test?: string;
  /** Max auto-fix retry attempts */
  maxRetries: number;
  /** Timeout per command in ms */
  timeoutMs: number;
}

export interface AutoFixResult {
  hasErrors: boolean;
  errorSummary: string;
  lintOutput?: string;
  testOutput?: string;
}

// ─── Defaults ──────────────────────────────────────────────

const DEFAULT_CONFIG: AutoFixConfig = {
  enabled: true,
  maxRetries: 3,
  timeoutMs: 30000,
};

/** Tools that should trigger auto-fix */
const AUTO_FIX_TOOLS = new Set(['write', 'edit', 'file_write', 'file_edit']);

// ─── Auto-Fix Logic ────────────────────────────────────────

/**
 * Check if a tool should trigger auto-fix.
 */
export function shouldRunAutoFix(toolName: string, config: AutoFixConfig | null): boolean {
  if (!config || !config.enabled) return false;
  return AUTO_FIX_TOOLS.has(toolName);
}

/**
 * Build the auto-fix feedback message to inject into the conversation.
 * This tells the model about errors it needs to fix.
 */
export function buildAutoFixFeedback(result: AutoFixResult): string | null {
  if (!result.hasErrors || !result.errorSummary) return null;

  return (
    `<auto_fix_feedback>\n` +
    `AUTO-FIX: The file you just edited has errors. Please fix them:\n\n` +
    `${result.errorSummary}\n\n` +
    `Please fix these errors in the files you just edited. ` +
    `Do not ask the user — just apply the fix.\n` +
    `</auto_fix_feedback>`
  );
}

/**
 * Run auto-fix commands and return the result.
 * Executes lint and/or test commands and captures output.
 */
export async function runAutoFix(
  config: AutoFixConfig,
  workingDir: string,
): Promise<AutoFixResult> {
  const errors: string[] = [];
  let lintOutput = '';
  let testOutput = '';

  // Run lint
  if (config.lint) {
    try {
      const result = await runCommand(config.lint, workingDir, config.timeoutMs);
      lintOutput = result.stdout + result.stderr;
      if (result.exitCode !== 0) {
        errors.push(`Lint errors:\n${truncate(lintOutput, 2000)}`);
      }
    } catch (e) {
      errors.push(`Lint failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Run test
  if (config.test) {
    try {
      const result = await runCommand(config.test, workingDir, config.timeoutMs);
      testOutput = result.stdout + result.stderr;
      if (result.exitCode !== 0) {
        errors.push(`Test failures:\n${truncate(testOutput, 2000)}`);
      }
    } catch (e) {
      errors.push(`Test failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    hasErrors: errors.length > 0,
    errorSummary: errors.join('\n\n'),
    lintOutput,
    testOutput,
  };
}

// ─── Helpers ───────────────────────────────────────────────

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandResult> {
  const { execSync } = await import('child_process');

  try {
    const output = execSync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: output, stderr: '' };
  } catch (e: any) {
    return {
      exitCode: e.status || 1,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
    };
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n[... truncated, ${text.length - maxLen} more chars]`;
}
