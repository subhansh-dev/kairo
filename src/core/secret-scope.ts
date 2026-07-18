/**
 * Profile-scoped credential resolution.
 *
 * Provides fail-closed secret resolution so credentials from different
 * profiles don't leak across sessions.
 */

// Module-level secret scope
let secretScope: Map<string, string> | null = null;
let multiplexActive = false;

/**
 * Set whether the process is running as a profile multiplexer.
 */
export function setMultiplexActive(active: boolean): void {
  multiplexActive = active;
}

/**
 * Check if multiplex mode is active.
 */
export function isMultiplexActive(): boolean {
  return multiplexActive;
}

/**
 * Install the active profile's secret mapping.
 */
export function setSecretScope(secrets: Map<string, string> | null): void {
  secretScope = secrets;
}

/**
 * Clear the secret scope.
 */
export function clearSecretScope(): void {
  secretScope = null;
}

/**
 * Get the current secret scope.
 */
export function getSecretScope(): Map<string, string> | null {
  return secretScope;
}

/**
 * Get a secret by name. In multiplex mode, fails closed if no scope is set.
 */
export function getSecret(name: string): string | undefined {
  // Check scope first
  if (secretScope) {
    return secretScope.get(name);
  }

  // In multiplex mode without a scope, fail closed
  if (multiplexActive) {
    throw new Error(
      `Secret "${name}" requested without a profile scope. ` +
      `In multiplex mode, set_secret_scope() must be called first.`
    );
  }

  // Single-profile mode: read from environment
  return process.env[name];
}

/**
 * Check if a secret exists in the current scope.
 */
export function hasSecret(name: string): boolean {
  if (secretScope) return secretScope.has(name);
  if (multiplexActive) return false;
  return name in process.env;
}

/**
 * Get all secret names in the current scope.
 */
export function getSecretNames(): string[] {
  if (secretScope) return [...secretScope.keys()];
  return [];
}

/**
 * Run a function with a temporary secret scope.
 */
export async function withSecretScope<T>(
  secrets: Map<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = secretScope;
  secretScope = secrets;
  try {
    return await fn();
  } finally {
    secretScope = prev;
  }
}
