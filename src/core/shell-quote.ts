/**
 * Shell argument parser — safely parse shell command strings.
 */

/**
 * Escape a string for safe use in a shell command.
 */
export function shellEscape(arg: string): string {
  // If the string is empty, return ''
  if (!arg) return "''";
  // If the string contains only safe characters, return as-is
  if (/^[a-zA-Z0-9._\-\/=:@]+$/.test(arg)) return arg;
  // Otherwise, wrap in single quotes and escape any single quotes
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Split a shell command string into arguments.
 * Handles quotes and escapes correctly.
 */
export function shellSplit(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === ' ' && !inSingle && !inDouble) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) args.push(current);
  return args;
}

/**
 * Join arguments into a shell command string.
 */
export function shellJoin(args: string[]): string {
  return args.map(shellEscape).join(' ');
}

/**
 * Check if a command looks dangerous.
 */
export function isDangerousCommand(command: string): boolean {
  const dangerous = [
    /\brm\s+-rf\b/,
    /\bmkfs\b/,
    /\bdd\b.*of=\/dev/,
    /\b:(){ :|:& };:/,  // fork bomb
    /\bchmod\b.*777/,
    /\bwget\b.*\|\s*sh/,
    /\bcurl\b.*\|\s*sh/,
    />\s*\/dev\/sd[a-z]/,
  ];
  return dangerous.some(pattern => pattern.test(command));
}
