/**
 * Hub authentication — auth provider types and auth.json parsing.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface AuthEntry {
  key: string;
  userId?: string;
  refreshToken?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  principalType?: string;
  principalId?: string;
  expiresAt?: string;
}

export interface AuthIdentity {
  userId: string;
  principalType?: string;
  principalId?: string;
}

export interface AuthCredential {
  token: string;
  identity?: AuthIdentity;
}

export interface AuthProvider {
  current(): AuthCredential;
  identity(): AuthIdentity | null;
}

/**
 * Plain bearer provider with identity. Used for local-dev path.
 */
export class BearerAuthProvider implements AuthProvider {
  private token: string;
  private authIdentity: AuthIdentity;

  constructor(token: string, identity: AuthIdentity) {
    this.token = token;
    this.authIdentity = identity;
  }

  current(): AuthCredential {
    return { token: this.token, identity: this.authIdentity };
  }

  identity(): AuthIdentity | null {
    return this.authIdentity;
  }
}

function defaultAuthPath(): string {
  const grokHome = process.env.GROK_HOME || path.join(os.homedir(), '.grok');
  return path.join(grokHome, 'auth.json');
}

/**
 * Read auth entries from the auth.json file.
 */
export async function readAuthEntries(authPath?: string): Promise<Map<string, AuthEntry>> {
  const filePath = authPath || defaultAuthPath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const raw = JSON.parse(content) as Record<string, any>;

    const entries = new Map<string, AuthEntry>();
    for (const [key, value] of Object.entries(raw)) {
      entries.set(key, {
        key,
        userId: value.user_id || value.userId || '',
        refreshToken: value.refresh_token || value.refreshToken,
        oidcIssuer: value.oidc_issuer || value.oidcIssuer,
        oidcClientId: value.oidc_client_id || value.oidcClientId,
        principalType: value.principal_type || value.principalType,
        principalId: value.principal_id || value.principalId,
        expiresAt: value.expires_at || value.expiresAt,
      });
    }

    return entries;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `No auth credentials found at ${filePath}. Run \`grok login\` first.`
      );
    }
    throw new Error(`Failed to read auth file ${filePath}: ${err.message}`);
  }
}

/**
 * Find the active OIDC entry (has refresh_token and oidc_issuer).
 */
export async function findActiveOidcEntry(authPath?: string): Promise<{
  key: string;
  entry: AuthEntry;
} | null> {
  const entries = await readAuthEntries(authPath);

  for (const [key, entry] of entries) {
    if (entry.refreshToken && entry.oidcIssuer) {
      return { key, entry };
    }
  }

  return null;
}

/**
 * Create a BearerAuthProvider from auth.json.
 */
export async function createAuthProvider(authPath?: string): Promise<AuthProvider> {
  const entries = await readAuthEntries(authPath);

  // Find first entry with a key (token)
  for (const [, entry] of entries) {
    if (entry.key) {
      return new BearerAuthProvider(entry.key, {
        userId: entry.userId || '',
        principalType: entry.principalType,
        principalId: entry.principalId,
      });
    }
  }

  throw new Error('No valid auth entry found');
}
