/**
 * Microsoft Graph — Microsoft Graph API integration.
 */

export interface MSGraphConfig {
  clientId: string;
  tenantId: string;
  scopes: string[];
}

export interface MSGraphUser {
  id: string;
  displayName: string;
  mail?: string;
  userPrincipalName: string;
}

/**
 * Build Microsoft Graph auth URL.
 */
export function buildMSAuthUrl(config: MSGraphConfig, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    response_mode: 'query',
  });
  return `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Build Microsoft Graph token request.
 */
export function buildMSTokenRequest(config: MSGraphConfig, code: string, redirectUri: string, clientSecret: string): Record<string, string> {
  return {
    client_id: config.clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: config.scopes.join(' '),
  };
}

/**
 * Format Microsoft Graph user for display.
 */
export function formatMSUser(user: MSGraphUser): string {
  return `${user.displayName} (${user.mail || user.userPrincipalName})`;
}
