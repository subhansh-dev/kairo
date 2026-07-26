/**
 * Daemon pool — daemon process pool management.
 */

export interface DaemonProcess {
  id: string;
  name: string;
  pid?: number;
  command: string;
  args: string[];
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: number;
  stoppedAt?: number;
  error?: string;
}

// Daemon pool
const daemons = new Map<string, DaemonProcess>();

/**
 * Register a daemon process.
 */
export function registerDaemon(name: string, command: string, args: string[] = []): DaemonProcess {
  const daemon: DaemonProcess = {
    id: `daemon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    command,
    args,
    status: 'starting',
    startedAt: Date.now(),
  };
  daemons.set(daemon.id, daemon);
  return daemon;
}

/**
 * Update daemon status.
 */
export function updateDaemonStatus(id: string, status: DaemonProcess['status'], pid?: number, error?: string): boolean {
  const daemon = daemons.get(id);
  if (!daemon) return false;
  daemon.status = status;
  if (pid) daemon.pid = pid;
  if (error) daemon.error = error;
  if (status === 'stopped' || status === 'error') daemon.stoppedAt = Date.now();
  return true;
}

/**
 * Get all daemons.
 */
export function getDaemons(): DaemonProcess[] {
  return [...daemons.values()];
}

/**
 * Get running daemons.
 */
export function getRunningDaemons(): DaemonProcess[] {
  return [...daemons.values()].filter(d => d.status === 'running');
}

/**
 * Stop a daemon.
 */
export function stopDaemon(id: string): boolean {
  const daemon = daemons.get(id);
  if (!daemon || daemon.status !== 'running') return false;
  daemon.status = 'stopped';
  daemon.stoppedAt = Date.now();
  return true;
}

/**
 * Format daemons for display.
 */
export function formatDaemons(): string {
  const all = getDaemons();
  if (all.length === 0) return 'No daemons running.';

  const statusIcon = { starting: '🔄', running: '✅', stopped: '⏸️', error: '❌' };
  return all.map(d =>
    `${statusIcon[d.status]} ${d.name} (${d.command})${d.pid ? ` PID:${d.pid}` : ''}`
  ).join('\n');
}
