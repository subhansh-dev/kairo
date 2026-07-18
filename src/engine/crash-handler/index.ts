/**
 * Crash handler — graceful crash recovery and reporting.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CrashReport {
  timestamp: Date;
  error: string;
  stack?: string;
  signal?: string;
  pid: number;
  platform: string;
  nodeVersion: string;
  uptime: number;
  memoryUsage: ReturnType<typeof process.memoryUsage>;
  cwd: string;
  argv: string[];
}

export interface CrashHandlerConfig {
  enabled: boolean;
  reportDir: string;
  maxReports: number;
  onCrash?: (report: CrashReport) => void;
}

const DEFAULT_CONFIG: CrashHandlerConfig = {
  enabled: true,
  reportDir: path.join(os.homedir(), '.kairo', 'crashes'),
  maxReports: 50,
};

let installed = false;
let config: CrashHandlerConfig = DEFAULT_CONFIG;

/**
 * Install the crash handler.
 */
export function installCrashHandler(userConfig?: Partial<CrashHandlerConfig>): void {
  if (installed) return;
  config = { ...DEFAULT_CONFIG, ...userConfig };
  installed = true;

  process.on('uncaughtException', (error) => {
    const report = buildCrashReport(error);
    saveCrashReport(report);
    if (config.onCrash) config.onCrash(report);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const report = buildCrashReport(error);
    saveCrashReport(report);
    if (config.onCrash) config.onCrash(report);
  });

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGHUP', () => handleSignal('SIGHUP'));
}

function handleSignal(signal: string): void {
  const report = buildCrashReport(new Error(`Signal received: ${signal}`), signal);
  saveCrashReport(report);
  process.exit(128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGINT' ? 2 : 1));
}

function buildCrashReport(error: Error, signal?: string): CrashReport {
  return {
    timestamp: new Date(),
    error: error.message,
    stack: error.stack,
    signal,
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cwd: process.cwd(),
    argv: process.argv,
  };
}

function saveCrashReport(report: CrashReport): void {
  try {
    if (!config.enabled) return;
    if (!fs.existsSync(config.reportDir)) {
      fs.mkdirSync(config.reportDir, { recursive: true });
    }

    const filename = `crash-${report.timestamp.toISOString().replace(/[:.]/g, '-')}.json`;
    const filepath = path.join(config.reportDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

    pruneOldReports(config.reportDir, config.maxReports);
  } catch {
    // Best effort — don't crash while handling a crash
  }
}

function pruneOldReports(dir: string, maxReports: number): void {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('crash-') && f.endsWith('.json'))
      .sort();

    while (files.length > maxReports) {
      const oldest = files.shift()!;
      fs.unlinkSync(path.join(dir, oldest));
    }
  } catch {
    // Best effort
  }
}

/**
 * Get all crash reports.
 */
export function getCrashReports(dir?: string): CrashReport[] {
  const reportDir = dir ?? config.reportDir;
  if (!fs.existsSync(reportDir)) return [];

  const files = fs.readdirSync(reportDir)
    .filter(f => f.startsWith('crash-') && f.endsWith('.json'))
    .sort()
    .reverse();

  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(reportDir, f), 'utf-8'));
    } catch {
      return null;
    }
  }).filter(Boolean) as CrashReport[];
}

/**
 * Clear all crash reports.
 */
export function clearCrashReports(dir?: string): void {
  const reportDir = dir ?? config.reportDir;
  if (!fs.existsSync(reportDir)) return;

  const files = fs.readdirSync(reportDir)
    .filter(f => f.startsWith('crash-') && f.endsWith('.json'));

  for (const f of files) {
    fs.unlinkSync(path.join(reportDir, f));
  }
}
