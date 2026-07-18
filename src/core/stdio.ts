/**
 * Stdio — safe stdio utilities.
 */

/**
 * Create a safe stdout writer that handles broken pipes.
 */
export function createSafeStdout(): NodeJS.WriteStream {
  const original = process.stdout;
  const handler: ProxyHandler<typeof original> = {
    get(target, prop) {
      if (prop === 'write') {
        return (...args: any[]) => {
          try {
            return (target.write as any)(...args);
          } catch {
            return false;
          }
        };
      }
      return (target as any)[prop];
    },
  };
  return new Proxy(original, handler);
}

/**
 * Create a safe stderr writer that handles broken pipes.
 */
export function createSafeStderr(): NodeJS.WriteStream {
  const original = process.stderr;
  const handler: ProxyHandler<typeof original> = {
    get(target, prop) {
      if (prop === 'write') {
        return (...args: any[]) => {
          try {
            return (target.write as any)(...args);
          } catch {
            return false;
          }
        };
      }
      return (target as any)[prop];
    },
  };
  return new Proxy(original, handler);
}

/**
 * Install safe stdio handlers.
 */
export function installSafeStdio(): void {
  process.stdout.on('error', () => { /* ignore broken pipe */ });
  process.stderr.on('error', () => { /* ignore broken pipe */ });
}

/**
 * Write to stdout safely.
 */
export function safeWrite(data: string): boolean {
  try {
    return process.stdout.write(data);
  } catch {
    return false;
  }
}

/**
 * Write to stderr safely.
 */
export function safeErrorWrite(data: string): boolean {
  try {
    return process.stderr.write(data);
  } catch {
    return false;
  }
}
