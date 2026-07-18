/**
 * Runtime-tunable timing/threshold config for the workspace tool server.
 *
 * All values read from environment variables with sensible defaults.
 */

export interface StatusConfig {
  heartbeatSecs: number;
  keepaliveSecs: number;
  wsPingSecs: number;
  hubWarnThreshold: number;
  hubBackoffBaseMs: number;
  sessionIdlePruneSecs: number;
  drainTimeoutSecs: number;
  agentRpcTimeoutSecs: number;
  agentConnectTimeoutSecs: number;
  idleIgnoresBackground: boolean;
  previewActivityWindowMs: number;
  previewActivityScrapeIntervalMs: number;
}

const DEFAULTS: StatusConfig = {
  heartbeatSecs: 30,
  keepaliveSecs: 60,
  wsPingSecs: 30,
  hubWarnThreshold: 5,
  hubBackoffBaseMs: 100,
  sessionIdlePruneSecs: 1800,
  drainTimeoutSecs: 30,
  agentRpcTimeoutSecs: 30,
  agentConnectTimeoutSecs: 5,
  idleIgnoresBackground: false,
  previewActivityWindowMs: 60_000,
  previewActivityScrapeIntervalMs: 10_000,
};

/**
 * Create a StatusConfig from environment variables.
 */
export function createStatusConfig(overrides: Partial<StatusConfig> = {}): StatusConfig {
  const env = process.env;

  const config: StatusConfig = {
    heartbeatSecs: parseEnvInt(env['KAIRO_HEARTBEAT_SECS']) ?? DEFAULTS.heartbeatSecs,
    keepaliveSecs: parseEnvInt(env['KAIRO_KEEPALIVE_SECS']) ?? DEFAULTS.keepaliveSecs,
    wsPingSecs: parseEnvInt(env['KAIRO_WS_PING_SECS']) ?? DEFAULTS.wsPingSecs,
    hubWarnThreshold: parseEnvInt(env['KAIRO_HUB_WARN_THRESHOLD']) ?? DEFAULTS.hubWarnThreshold,
    hubBackoffBaseMs: parseEnvInt(env['KAIRO_HUB_BACKOFF_BASE_MS']) ?? DEFAULTS.hubBackoffBaseMs,
    sessionIdlePruneSecs: parseEnvInt(env['KAIRO_SESSION_IDLE_PRUNE_SECS']) ?? DEFAULTS.sessionIdlePruneSecs,
    drainTimeoutSecs: parseEnvInt(env['KAIRO_DRAIN_TIMEOUT_SECS']) ?? DEFAULTS.drainTimeoutSecs,
    agentRpcTimeoutSecs: parseEnvInt(env['KAIRO_AGENT_RPC_TIMEOUT_SECS']) ?? DEFAULTS.agentRpcTimeoutSecs,
    agentConnectTimeoutSecs: parseEnvInt(env['KAIRO_AGENT_CONNECT_TIMEOUT_SECS']) ?? DEFAULTS.agentConnectTimeoutSecs,
    idleIgnoresBackground: env['KAIRO_IDLE_IGNORE_BACKGROUND_TASKS'] === 'true',
    previewActivityWindowMs: parseEnvInt(env['KAIRO_PREVIEW_ACTIVITY_WINDOW_MS']) ?? DEFAULTS.previewActivityWindowMs,
    previewActivityScrapeIntervalMs: parseEnvInt(env['KAIRO_PREVIEW_ACTIVITY_SCRAPE_INTERVAL_MS']) ?? DEFAULTS.previewActivityScrapeIntervalMs,
    ...overrides,
  };

  return validateStatusConfig(config);
}

function parseEnvInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

function validateStatusConfig(config: StatusConfig): StatusConfig {
  const validated = { ...config };

  // Enforce minimums
  if (validated.heartbeatSecs < 1) validated.heartbeatSecs = DEFAULTS.heartbeatSecs;
  if (validated.keepaliveSecs < validated.heartbeatSecs) {
    validated.keepaliveSecs = validated.heartbeatSecs + 30;
  }
  if (validated.wsPingSecs < 1) validated.wsPingSecs = DEFAULTS.wsPingSecs;
  if (validated.sessionIdlePruneSecs < 60) validated.sessionIdlePruneSecs = 60;
  if (validated.previewActivityWindowMs < 2) validated.previewActivityWindowMs = 2;
  if (validated.previewActivityScrapeIntervalMs < 1) validated.previewActivityScrapeIntervalMs = 1;
  if (validated.previewActivityScrapeIntervalMs >= validated.previewActivityWindowMs) {
    validated.previewActivityScrapeIntervalMs = validated.previewActivityWindowMs - 1;
  }

  return validated;
}
