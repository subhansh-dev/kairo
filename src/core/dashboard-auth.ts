/**
 * Dashboard auth — dashboard authentication.
 */

export interface AuthSession {
  id: string;
  userId?: string;
  createdAt: number;
  expiresAt: number;
  permissions: string[];
}

// Active sessions
const sessions = new Map<string, AuthSession>();

/**
 * Create an auth session.
 */
export function createAuthSession(userId?: string, permissions: string[] = []): AuthSession {
  const session: AuthSession = {
    id: `auth_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600_000, // 1 hour
    permissions,
  };
  sessions.set(session.id, session);
  return session;
}

/**
 * Validate an auth session.
 */
export function validateAuthSession(sessionId: string): { valid: boolean; session?: AuthSession; error?: string } {
  const session = sessions.get(sessionId);
  if (!session) return { valid: false, error: 'Session not found' };
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return { valid: false, error: 'Session expired' };
  }
  return { valid: true, session };
}

/**
 * Invalidate an auth session.
 */
export function invalidateAuthSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/**
 * Check if a session has a permission.
 */
export function hasPermission(sessionId: string, permission: string): boolean {
  const { valid, session } = validateAuthSession(sessionId);
  if (!valid || !session) return false;
  return session.permissions.includes(permission) || session.permissions.includes('*');
}
