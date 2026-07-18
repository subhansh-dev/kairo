/**
 * Proxy server — local proxy for API requests.
 */

export interface ProxyConfig {
  port: number;
  host: string;
  targetUrl: string;
  auth?: { username: string; password: string };
}

export interface ProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Build a proxy configuration.
 */
export function buildProxyConfig(opts: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    port: opts.port || 8080,
    host: opts.host || 'localhost',
    targetUrl: opts.targetUrl || 'https://api.openai.com',
    auth: opts.auth,
  };
}

/**
 * Check if a request should be proxied.
 */
export function shouldProxy(path: string): boolean {
  // Proxy API requests
  return path.startsWith('/v1/') || path.startsWith('/api/');
}

/**
 * Build proxied request URL.
 */
export function buildProxiedUrl(config: ProxyConfig, path: string): string {
  return `${config.targetUrl}${path}`;
}
