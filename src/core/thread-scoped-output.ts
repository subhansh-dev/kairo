/**
 * Thread-scoped output silencing for background workers.
 *
 * In Node.js, we use AsyncLocalStorage to scope output suppression
 * to specific async contexts without affecting other concurrent work.
 */

import { AsyncLocalStorage } from 'async_hooks';

// AsyncLocalStorage for tracking silenced contexts
const silencedStore = new AsyncLocalStorage<boolean>();

/**
 * Check if the current async context is silenced.
 */
export function isSilenced(): boolean {
  return silencedStore.getStore() === true;
}

/**
 * Run a function with output silenced for the current async context.
 * Other async contexts keep their output.
 */
export async function withSilencedOutput<T>(fn: () => Promise<T>): Promise<T> {
  return silencedStore.run(true, fn);
}

/**
 * Run a function with output silenced synchronously.
 */
export function withSilencedOutputSync<T>(fn: () => T): T {
  return silencedStore.run(true, fn);
}

/**
 * Create a conditional writer that discards output when silenced.
 */
export function createConditionalWriter(original: NodeJS.WriteStream): NodeJS.WriteStream {
  const handler: ProxyHandler<typeof original> = {
    get(target, prop) {
      if (prop === 'write') {
        return (...args: any[]) => {
          if (isSilenced()) return true;
          return (target.write as any)(...args);
        };
      }
      return (target as any)[prop];
    },
  };
  return new Proxy(original, handler);
}

/**
 * Suppress console.log/error/warn for the current async context.
 */
export function suppressConsole(): () => void {
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args: any[]) => {
    if (!isSilenced()) origLog(...args);
  };
  console.error = (...args: any[]) => {
    if (!isSilenced()) origError(...args);
  };
  console.warn = (...args: any[]) => {
    if (!isSilenced()) origWarn(...args);
  };

  return () => {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  };
}
