/**
 * Status — system status display.
 */

export interface SystemStatus {
  version: string;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  activeSessions: number;
  providers: Array<{ name: string; available: boolean }>;
  tools: number;
  skills: number;
}

/**
 * Get system status.
 */
export function getSystemStatus(): SystemStatus {
  return {
    version: getVersion(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    activeSessions: 0, // Would need session manager reference
    providers: [],     // Would need registry reference
    tools: 0,          // Would need tool registry reference
    skills: 0,         // Would need skill loader reference
  };
}

/**
 * Format system status for display.
 */
export function formatSystemStatus(status: SystemStatus): string {
  const lines = [
    `Kairo v${status.version}`,
    `Uptime: ${(status.uptime / 60).toFixed(1)}m`,
    `Memory: ${Math.round(status.memoryUsage.heapUsed / 1024 / 1024)}MB`,
    `Sessions: ${status.activeSessions}`,
    `Providers: ${status.providers.map(p => `${p.name}(${p.available ? '✓' : '✗'})`).join(', ') || 'none'}`,
    `Tools: ${status.tools}`,
    `Skills: ${status.skills}`,
  ];
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
