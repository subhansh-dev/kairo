/**
 * Bash command splitting for permission evaluation.
 *
 * Parses bash scripts into individual commands for classification.
 * Handles pipes, logical operators, env assignments, and wrappers.
 */

export interface PlainCommand {
  words: string[];
  spanStart: number;
  spanEnd: number;
}

export interface BashCommandHighlights {
  prefix: string[];
  highlightedWords: string[];
  suffix: string[];
}

/**
 * Unwrap wrapper commands (env, sudo, etc.) to get the core command.
 */
export function unwrapWrappers(words: string[]): string[] {
  const wrappers = new Set(['env', 'sudo', 'nohup', 'nice', 'time', 'strace', 'ltrace']);
  let result = [...words];

  while (result.length > 0 && wrappers.has(result[0])) {
    // Skip env args (KEY=VALUE), sudo flags (-u user), etc.
    let skipCount = 1;
    while (skipCount < result.length && result[skipCount].includes('=')) {
      skipCount++;
    }
    if (skipCount < result.length && result[skipCount].startsWith('-')) {
      skipCount++;
    }
    result = result.slice(skipCount);
  }

  return result;
}

/**
 * Check if a wrapper command contains a directory change.
 */
export function wrapperHasChdir(words: string[]): boolean {
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === '-C' || words[i] === '--directory') {
      return true;
    }
    if (words[i] === 'env' && words[i + 1]?.startsWith('PWD=')) {
      return true;
    }
  }
  return false;
}

/**
 * Extract the primary command from a bash script.
 */
export function primaryCommandFromScript(script: string): string | null {
  const words = script.trim().split(/\s+/);
  if (words.length === 0) return null;

  const unwrapped = unwrapWrappers(words);
  return unwrapped[0] || null;
}

/**
 * Get bash command highlights for permission prompts.
 */
export function getBashCommandHighlights(script: string): BashCommandHighlights {
  const words = script.trim().split(/\s+/);
  const unwrapped = unwrapWrappers(words);

  if (unwrapped.length === 0) {
    return { prefix: [], highlightedWords: [], suffix: [] };
  }

  const prefixWords = words.slice(0, words.length - unwrapped.length);
  const highlighted = unwrapped.slice(0, Math.min(3, unwrapped.length));
  const suffix = unwrapped.slice(highlighted.length);

  return {
    prefix: prefixWords,
    highlightedWords: highlighted,
    suffix,
  };
}

/**
 * Check if a command is a wrapper command (env, sudo, etc.).
 */
export function isWrapperCommand(program: string): boolean {
  return ['env', 'sudo', 'nohup', 'nice', 'time', 'strace', 'ltrace'].includes(program);
}

/**
 * Strip wrapper commands to get the core command.
 */
export function stripWrapperCommand(words: string[]): string[] {
  return unwrapWrappers(words);
}

/**
 * Check if a bash command sequence is safe (only word-only commands).
 */
export function isWordOnlySequence(script: string): boolean {
  const trimmed = script.trim();
  if (!trimmed) return false;

  // Check for dangerous constructs
  const dangerous = ['`', '$(', '${', '<(', '<<<', '||{', '&&{'];
  for (const d of dangerous) {
    if (trimmed.includes(d)) return false;
  }

  // Check for control flow
  const controlFlow = ['if ', 'then ', 'else ', 'elif ', 'fi', 'for ', 'while ', 'until ', 'do ', 'done', 'case ', 'esac'];
  for (const cf of controlFlow) {
    if (trimmed.includes(cf)) return false;
  }

  return true;
}

/**
 * Split a script into individual commands by safe operators.
 */
export function splitByOperators(script: string): string[] {
  // Simple split by &&, ||, ;, |
  const parts: string[] = [];
  let current = '';
  let i = 0;

  while (i < script.length) {
    if (script[i] === '&' && script[i + 1] === '&') {
      parts.push(current.trim());
      current = '';
      i += 2;
    } else if (script[i] === '|' && script[i + 1] === '|') {
      parts.push(current.trim());
      current = '';
      i += 2;
    } else if (script[i] === ';') {
      parts.push(current.trim());
      current = '';
      i += 1;
    } else {
      current += script[i];
      i += 1;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(Boolean);
}
