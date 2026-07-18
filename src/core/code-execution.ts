/**
 * Code execution — sandboxed code execution utilities.
 */

export interface CodeExecutionRequest {
  code: string;
  language: string;
  timeout?: number;
  args?: string[];
}

export interface CodeExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Build a code execution request.
 */
export function buildCodeExecutionRequest(code: string, language: string, opts: Partial<CodeExecutionRequest> = {}): CodeExecutionRequest {
  return {
    code,
    language,
    timeout: opts.timeout || 30000,
    args: opts.args,
  };
}

/**
 * Format code execution result for display.
 */
export function formatCodeExecutionResult(result: CodeExecutionResult): string {
  const icon = result.success ? '✅' : '❌';
  const parts = [`${icon} Exit code: ${result.exitCode} (${result.durationMs}ms)`];

  if (result.stdout) {
    const preview = result.stdout.length > 500 ? result.stdout.slice(0, 500) + '…' : result.stdout;
    parts.push(`Output:\n${preview}`);
  }

  if (result.stderr) {
    const preview = result.stderr.length > 500 ? result.stderr.slice(0, 500) + '…' : result.stderr;
    parts.push(`Errors:\n${preview}`);
  }

  return parts.join('\n');
}

/**
 * Get supported languages.
 */
export function getSupportedLanguages(): string[] {
  return ['javascript', 'typescript', 'python', 'bash', 'ruby', 'go', 'rust'];
}

/**
 * Check if a language is supported.
 */
export function isLanguageSupported(language: string): boolean {
  return getSupportedLanguages().includes(language.toLowerCase());
}
