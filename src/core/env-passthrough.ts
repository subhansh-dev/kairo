/**
 * Env passthrough — manage environment variable passthrough to tools.
 */

// Environment variables that are safe to pass through to tools
const SAFE_ENV_VARS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TZ',
  'PWD', 'OLDPWD', 'TMPDIR', 'TEMP', 'TMP',
  'NODE_ENV', 'NODE_PATH', 'NODE_OPTIONS',
  'NPM_CONFIG_PREFIX', 'NPM_CONFIG_CACHE',
  'PYTHONPATH', 'PYTHONHOME',
  'GOPATH', 'GOROOT', 'CARGO_HOME',
  'JAVA_HOME', 'ANDROID_HOME',
  'http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'CI', 'GITHUB_ACTIONS', 'GITHUB_TOKEN',
]);

// Environment variables that should NEVER be passed through
const BLOCKED_ENV_VARS = new Set([
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN', 'GITLAB_TOKEN',
  'NPM_TOKEN', 'PYPI_TOKEN',
  'DATABASE_URL', 'REDIS_URL',
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
]);

/**
 * Get environment variables safe for passthrough to tools.
 */
export function getSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (BLOCKED_ENV_VARS.has(key)) continue;
    if (SAFE_ENV_VARS.has(key)) {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Check if an environment variable is safe to pass through.
 */
export function isEnvSafe(name: string): boolean {
  if (BLOCKED_ENV_VARS.has(name)) return false;
  return SAFE_ENV_VARS.has(name);
}

/**
 * Get a sanitized environment for subprocess execution.
 */
export function getSubprocessEnv(overrides?: Record<string, string>): Record<string, string> {
  return {
    ...getSafeEnv(),
    ...overrides,
  };
}
