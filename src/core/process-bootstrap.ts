/**
 * Process bootstrap helpers.
 *
 * Handles lazy imports, crash-resistant stdio, and HTTP proxy resolution.
 */



/**
 * Lazy import wrapper — defers expensive imports until first use.
 */
export function createLazyLoader<T>(loader: () => T): () => T {
  let cached: T | undefined;
  let loaded = false;
  return () => {
    if (!loaded) {
      cached = loader();
      loaded = true;
    }
    return cached!;
  };
}

/**
 * Install crash-resistant stdio handlers.
 * Catches broken pipe errors that can crash the agent.
 */
export function installSafeStdio(): void {
  process.stdout.on('error', () => { /* ignore broken pipe */ });
  process.stderr.on('error', () => { /* ignore broken pipe */ });
}

/**
 * Check if we're running in a headless/daemon environment.
 */
export function isHeadless(): boolean {
  return !process.stdout.isTTY || process.env.KAIRO_HEADLESS === '1';
}

/**
 * Get the current working directory, with fallback.
 */
export function getSafeCwd(): string {
  try {
    return process.cwd();
  } catch {
    return process.env.HOME || process.env.USERPROFILE || '/';
  }
}

/**
 * Check if a URL matches a NO_PROXY entry.
 */
export function isNoProxy(url: string): boolean {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  if (noProxy === '*') return true;
  if (!noProxy) return false;

  try {
    const hostname = new URL(url).hostname;
    const entries = noProxy.split(',').map(s => s.trim());
    for (const entry of entries) {
      if (entry === hostname) return true;
      if (hostname.endsWith(`.${entry}`)) return true;
      if (entry === 'localhost' && hostname === 'localhost') return true;
      if (entry === '127.0.0.1' && hostname === '127.0.0.1') return true;
    }
  } catch { /* ignore URL parse errors */ }

  return false;
}
