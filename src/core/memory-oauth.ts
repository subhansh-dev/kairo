/**
 * Memory OAuth — OAuth integration for memory providers.
 */

export interface OAuthConfig {
  provider: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
}

/**
 * Build an OAuth authorization URL.
 */
export function buildAuthUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
  });
  return `https://auth.example.com/authorize?${params.toString()}`;
}

/**
 * Parse an OAuth callback URL.
 */
export function parseCallback(url: string): { code?: string; state?: string; error?: string } {
  try {
    const parsed = new URL(url);
    return {
      code: parsed.searchParams.get('code') || undefined,
      state: parsed.searchParams.get('state') || undefined,
      error: parsed.searchParams.get('error') || undefined,
    };
  } catch {
    return { error: 'Invalid callback URL' };
  }
}

/**
 * Check if a token is expired.
 */
export function isTokenExpired(token: OAuthToken): boolean {
  return Date.now() >= token.expiresAt;
}

/**
 * Format token for display (redacted).
 */
export function formatToken(token: OAuthToken): string {
  const masked = token.accessToken.slice(0, 6) + '***' + token.accessToken.slice(-4);
  const expires = new Date(token.expiresAt).toLocaleString();
  return `${token.tokenType} ${masked} (expires: ${expires})`;
}
