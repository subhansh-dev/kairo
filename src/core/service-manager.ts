/**
 * Service manager — manage background services.
 */

export interface ServiceStatus {
  name: string;
  running: boolean;
  pid?: number;
  uptime?: number;
  port?: number;
}

// Tracked services
const services = new Map<string, ServiceStatus>();

/**
 * Register a service.
 */
export function registerService(name: string, opts: Partial<ServiceStatus> = {}): void {
  services.set(name, {
    name,
    running: opts.running ?? false,
    pid: opts.pid,
    uptime: opts.uptime,
    port: opts.port,
  });
}

/**
 * Update service status.
 */
export function updateServiceStatus(name: string, running: boolean, pid?: number): boolean {
  const service = services.get(name);
  if (!service) return false;
  service.running = running;
  service.pid = pid;
  return true;
}

/**
 * Get service status.
 */
export function getServiceStatus(name: string): ServiceStatus | undefined {
  return services.get(name);
}

/**
 * Get all services.
 */
export function getAllServices(): ServiceStatus[] {
  return [...services.values()];
}

/**
 * Check if a service is running.
 */
export function isServiceRunning(name: string): boolean {
  return services.get(name)?.running ?? false;
}

/**
 * Format service status for display.
 */
export function formatServiceStatus(status: ServiceStatus): string {
  const icon = status.running ? '✅' : '⏸️';
  const pid = status.pid ? ` (PID: ${status.pid})` : '';
  const port = status.port ? ` :${status.port}` : '';
  return `${icon} ${status.name}${pid}${port}`;
}

/**
 * Format all services for display.
 */
export function formatAllServices(): string {
  const all = getAllServices();
  if (all.length === 0) return 'No services registered.';
  return all.map(formatServiceStatus).join('\n');
}
