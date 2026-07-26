/**
 * Dashboard register — dashboard endpoint registration.
 */

export interface DashboardEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  handler: (req: any) => Promise<any>;
  auth?: boolean;
  description?: string;
}

// Registered endpoints
const endpoints = new Map<string, DashboardEndpoint>();

/**
 * Register a dashboard endpoint.
 */
export function registerDashboardEndpoint(endpoint: DashboardEndpoint): void {
  const key = `${endpoint.method}:${endpoint.path}`;
  endpoints.set(key, endpoint);
}

/**
 * Get all registered endpoints.
 */
export function getDashboardEndpoints(): DashboardEndpoint[] {
  return [...endpoints.values()];
}

/**
 * Get an endpoint by path and method.
 */
export function getDashboardEndpoint(path: string, method: string): DashboardEndpoint | undefined {
  return endpoints.get(`${method}:${path}`);
}

/**
 * Format dashboard endpoints for display.
 */
export function formatDashboardEndpoints(): string {
  const all = getDashboardEndpoints();
  if (all.length === 0) return 'No dashboard endpoints registered.';
  return all.map(e =>
    `${e.method.padEnd(6)} ${e.path}${e.auth ? ' 🔒' : ''}${e.description ? ` — ${e.description}` : ''}`
  ).join('\n');
}

// Register built-in endpoints
registerDashboardEndpoint({
  path: '/api/status',
  method: 'GET',
  handler: async () => ({ status: 'ok' }),
  description: 'Health check',
});

registerDashboardEndpoint({
  path: '/api/sessions',
  method: 'GET',
  handler: async () => ({ sessions: [] }),
  auth: true,
  description: 'List sessions',
});
