/**
 * Gateway — messaging gateway utilities.
 */

export interface GatewayConfig {
  port: number;
  host: string;
  platforms: string[];
  auth?: { username: string; password: string };
}

export interface GatewayStatus {
  running: boolean;
  port: number;
  connections: number;
  uptime: number;
  platforms: Record<string, boolean>;
}

/**
 * Build a gateway configuration.
 */
export function buildGatewayConfig(opts: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: opts.port || 3000,
    host: opts.host || 'localhost',
    platforms: opts.platforms || [],
    auth: opts.auth,
  };
}

/**
 * Format gateway status for display.
 */
export function formatGatewayStatus(status: GatewayStatus): string {
  const icon = status.running ? '✅' : '⏸️';
  const lines = [
    `${icon} Gateway ${status.running ? 'running' : 'stopped'} on port ${status.port}`,
    `Connections: ${status.connections}`,
    `Uptime: ${(status.uptime / 60).toFixed(1)}m`,
  ];

  if (Object.keys(status.platforms).length > 0) {
    const platformStatus = Object.entries(status.platforms)
      .map(([name, connected]) => `${name}(${connected ? '✓' : '✗'})`)
      .join(', ');
    lines.push(`Platforms: ${platformStatus}`);
  }

  return lines.join('\n');
}
