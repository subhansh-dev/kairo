/**
 * Process registry — track running processes.
 */

export interface ProcessEntry {
  pid: number;
  name: string;
  command: string;
  startedAt: number;
  sessionId?: string;
}

// Registry of tracked processes
const processes = new Map<number, ProcessEntry>();

/**
 * Register a process.
 */
export function registerProcess(entry: ProcessEntry): void {
  processes.set(entry.pid, entry);
}

/**
 * Unregister a process.
 */
export function unregisterProcess(pid: number): void {
  processes.delete(pid);
}

/**
 * Get all registered processes.
 */
export function getRegisteredProcesses(): ProcessEntry[] {
  return [...processes.values()];
}

/**
 * Get a process by PID.
 */
export function getProcess(pid: number): ProcessEntry | undefined {
  return processes.get(pid);
}

/**
 * Get processes for a session.
 */
export function getSessionProcesses(sessionId: string): ProcessEntry[] {
  return [...processes.values()].filter(p => p.sessionId === sessionId);
}

/**
 * Check if a process is still running.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check if alive
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process by PID.
 */
export function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    unregisterProcess(pid);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill all processes for a session.
 */
export function killSessionProcesses(sessionId: string): number {
  let killed = 0;
  for (const entry of getSessionProcesses(sessionId)) {
    if (killProcess(entry.pid)) killed++;
  }
  return killed;
}

/**
 * Clean up dead processes from the registry.
 */
export function cleanupDeadProcesses(): number {
  let cleaned = 0;
  for (const [pid, entry] of processes) {
    if (!isProcessRunning(pid)) {
      processes.delete(pid);
      cleaned++;
    }
  }
  return cleaned;
}
