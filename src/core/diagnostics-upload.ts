/**
 * Diagnostics upload — upload diagnostics for debugging.
 */

export interface DiagnosticData {
  version: string;
  platform: string;
  nodeVersion: string;
  error?: string;
  logs?: string[];
  config?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Collect diagnostic data.
 */
export function collectDiagnostics(opts: { error?: string; includeConfig?: boolean } = {}): DiagnosticData {
  return {
    version: getVersion(),
    platform: process.platform,
    nodeVersion: process.version,
    error: opts.error,
    timestamp: Date.now(),
  };
}

/**
 * Format diagnostics for display.
 */
export function formatDiagnostics(data: DiagnosticData): string {
  const lines = [
    `Version: ${data.version}`,
    `Platform: ${data.platform}`,
    `Node.js: ${data.nodeVersion}`,
    `Timestamp: ${new Date(data.timestamp).toISOString()}`,
  ];
  if (data.error) lines.push(`Error: ${data.error}`);
  return lines.join('\n');
}

function getVersion(): string {
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
