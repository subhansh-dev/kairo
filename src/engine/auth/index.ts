/**
 * Auth provider — handles authentication with retry middleware.
 */

export interface AuthConfig {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AuthToken {
  token: string;
  expiresAt?: Date;
  refreshToken?: string;
}

export interface AuthProvider {
  getToken(): Promise<AuthToken | null>;
  refresh?(): Promise<AuthToken | null>;
  isAuthenticated(): boolean;
}

/**
 * Create a static auth provider (API key based).
 */
export function createStaticAuthProvider(apiKey: string): AuthProvider {
  return {
    async getToken() {
      return { token: apiKey };
    },
    isAuthenticated() {
      return !!apiKey;
    },
  };
}

/**
 * Retry middleware for auth operations.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  backoffMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = backoffMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Build auth headers from a token.
 */
export function buildAuthHeaders(token: AuthToken): Record<string, string> {
  return {
    Authorization: `Bearer ${token.token}`,
  };
}
