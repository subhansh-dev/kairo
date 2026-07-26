/**
 * Telemetry — tracing, logging, and metrics primitives.
 */

export type TelemetryLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface TelemetryEntry {
  timestamp: Date;
  level: TelemetryLevel;
  source: string;
  message: string;
  data?: Record<string, unknown>;
  sessionId?: string;
  durationMs?: number;
}

export interface TelemetryConfig {
  level: TelemetryLevel;
  enableConsole: boolean;
  enableFile: boolean;
  logDir?: string;
  maxFileSize: number;
  maxFiles: number;
}

const LEVEL_PRIORITY: Record<TelemetryLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  level: 'info',
  enableConsole: true,
  enableFile: false,
  maxFileSize: 5 * 1024 * 1024,
  maxFiles: 5,
};

export interface TelemetryLogger {
  trace(source: string, message: string, data?: Record<string, unknown>): void;
  debug(source: string, message: string, data?: Record<string, unknown>): void;
  info(source: string, message: string, data?: Record<string, unknown>): void;
  warn(source: string, message: string, data?: Record<string, unknown>): void;
  error(source: string, message: string, data?: Record<string, unknown>): void;
  entries(): TelemetryEntry[];
  clear(): void;
}

/**
 * Create a telemetry logger.
 */
export function createTelemetryLogger(
  config?: Partial<TelemetryConfig>,
): TelemetryLogger {
  const cfg = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
  const entries: TelemetryEntry[] = [];

  function log(level: TelemetryLevel, source: string, message: string, data?: Record<string, unknown>) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[cfg.level]) return;

    const entry: TelemetryEntry = {
      timestamp: new Date(),
      level,
      source,
      message,
      data,
    };

    entries.push(entry);

    if (cfg.enableConsole) {
      const prefix = `[${entry.timestamp.toISOString()}] [${level.toUpperCase()}] [${source}]`;
      const msg = `${prefix} ${message}`;
      switch (level) {
        case 'error': console.error(msg); break;
        case 'warn': console.warn(msg); break;
        case 'debug': console.debug(msg); break;
        default: console.log(msg);
      }
    }

    // Trim old entries
    while (entries.length > 10000) entries.shift();
  }

  return {
    trace: (s, m, d) => log('trace', s, m, d),
    debug: (s, m, d) => log('debug', s, m, d),
    info: (s, m, d) => log('info', s, m, d),
    warn: (s, m, d) => log('warn', s, m, d),
    error: (s, m, d) => log('error', s, m, d),
    entries: () => [...entries],
    clear: () => { entries.length = 0; },
  };
}

/**
 * Format a telemetry entry for display.
 */
export function formatTelemetryEntry(entry: TelemetryEntry): string {
  const ts = entry.timestamp.toISOString();
  const level = entry.level.toUpperCase().padEnd(5);
  const src = entry.source.padEnd(20);
  let msg = `[${ts}] [${level}] [${src}] ${entry.message}`;
  if (entry.durationMs !== undefined) msg += ` (${entry.durationMs}ms)`;
  return msg;
}
