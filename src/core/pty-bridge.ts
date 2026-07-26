/**
 * PTY bridge — pseudo-terminal bridge utilities.
 */

export interface PTYSession {
  id: string;
  pid?: number;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  startedAt: number;
}

// Active PTY sessions
const sessions = new Map<string, PTYSession>();

/**
 * Create a PTY session descriptor.
 */
export function createPTYSession(command: string, args: string[], cwd: string, env?: Record<string, string>): PTYSession {
  const session: PTYSession = {
    id: `pty_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    command,
    args,
    cwd,
    env: env || {},
    startedAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

/**
 * Get a PTY session by ID.
 */
export function getPTYSession(id: string): PTYSession | undefined {
  return sessions.get(id);
}

/**
 * Get all PTY sessions.
 */
export function getPTYSessions(): PTYSession[] {
  return [...sessions.values()];
}

/**
 * Close a PTY session.
 */
export function closePTYSession(id: string): boolean {
  return sessions.delete(id);
}

/**
 * Format PTY session for display.
 */
export function formatPTYSession(session: PTYSession): string {
  const duration = ((Date.now() - session.startedAt) / 1000).toFixed(0);
  return `[${session.id}] ${session.command} ${session.args.join(' ')} (${duration}s)`;
}
