/**
 * Shell access detection.
 *
 * Detect file reads/writes inside shell commands so managed
 * Read/Edit deny/ask can't be bypassed via shell redirects.
 */

export type ShellFileMode = 'read' | 'write';

export type Decision = 'allow' | 'deny' | 'ask';

export interface CompiledPolicy {
  hasFileRestrictions: boolean;
  evaluateShellPath: (path: string, cwd: string, mode: ShellFileMode) => Decision | null;
}

/**
 * Known shell file commands and their access modes.
 */
const SHELL_FILE_COMMANDS: Record<string, ShellFileMode[]> = {
  cat: ['read'],
  less: ['read'],
  more: ['read'],
  head: ['read'],
  tail: ['read'],
  grep: ['read'],
  ripgrep: ['read'],
  rg: ['read'],
  ag: ['read'],
  ack: ['read'],
  wc: ['read'],
  sort: ['read'],
  uniq: ['read'],
  diff: ['read'],
  vim: ['read', 'write'],
  vi: ['read', 'write'],
  nano: ['read', 'write'],
  emacs: ['read', 'write'],
  code: ['read', 'write'],
  cp: ['read', 'write'],
  mv: ['read', 'write'],
  rm: ['write'],
  mkdir: ['write'],
  touch: ['write'],
  tee: ['write'],
  sed: ['read', 'write'],
  awk: ['read', 'write'],
  xargs: ['read'],
  find: ['read'],
  ls: ['read'],
  tree: ['read'],
};

/**
 * Get the file access modes for a shell command.
 */
export function getShellFileModes(program: string): ShellFileMode[] | undefined {
  return SHELL_FILE_COMMANDS[program.toLowerCase()];
}

/**
 * Extract file operands from a shell command.
 */
export function extractFileOperands(words: string[]): string[] {
  const operands: string[] = [];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];

    // Skip flags
    if (word.startsWith('-')) continue;

    // Skip env var assignments
    if (word.includes('=')) continue;

    // Redirect targets (>, >>, <)
    if (word === '>' || word === '>>' || word === '<') {
      if (i + 1 < words.length) {
        operands.push(words[i + 1]);
        i++;
      }
      continue;
    }

    // fd-prefixed redirects (2>, etc.)
    if (/^\d+>/.test(word) || /^\d+>>/.test(word)) {
      continue;
    }

    // Filter flags with values (-o, --output, etc.)
    if (/^-[oOf]/.test(word)) {
      if (i + 1 < words.length) {
        operands.push(words[i + 1]);
        i++;
      }
      continue;
    }

    operands.push(word);
  }

  return operands;
}

/**
 * Evaluate shell file access against a policy.
 */
export function evaluateShellFileAccess(
  policy: CompiledPolicy,
  cmd: string,
  cwd: string
): Decision | null {
  if (!policy.hasFileRestrictions) return null;

  const words = cmd.trim().split(/\s+/);
  if (words.length === 0) return null;

  const program = words[0].toLowerCase();
  const modes = getShellFileModes(program);
  if (!modes) return null;

  const operands = extractFileOperands(words);
  let strongest: Decision | null = null;

  for (const operand of operands) {
    for (const mode of modes) {
      const decision = policy.evaluateShellPath(operand, cwd, mode);
      if (decision === 'deny') return 'deny';
      if (decision === 'ask') {
        strongest = 'ask';
      }
    }
  }

  return strongest;
}
