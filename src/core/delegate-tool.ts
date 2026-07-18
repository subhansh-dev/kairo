/**
 * Delegate tool — subagent delegation utilities.
 */

export interface DelegationResult {
  taskId: string;
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

// Active delegations
const delegations = new Map<string, DelegationResult>();

/**
 * Create a delegation.
 */
export function createDelegation(taskId: string, agent: string): DelegationResult {
  const result: DelegationResult = {
    taskId,
    agent,
    status: 'pending',
    startedAt: Date.now(),
  };
  delegations.set(taskId, result);
  return result;
}

/**
 * Update delegation status.
 */
export function updateDelegation(taskId: string, status: DelegationResult['status'], output?: string, error?: string): boolean {
  const delegation = delegations.get(taskId);
  if (!delegation) return false;
  delegation.status = status;
  if (output) delegation.output = output;
  if (error) delegation.error = error;
  if (status === 'completed' || status === 'failed') delegation.completedAt = Date.now();
  return true;
}

/**
 * Get delegation by task ID.
 */
export function getDelegation(taskId: string): DelegationResult | undefined {
  return delegations.get(taskId);
}

/**
 * Get all active delegations.
 */
export function getActiveDelegations(): DelegationResult[] {
  return [...delegations.values()].filter(d => d.status === 'running' || d.status === 'pending');
}

/**
 * Format delegation status for display.
 */
export function formatDelegationStatus(result: DelegationResult): string {
  const icon = { pending: '⏳', running: '🔄', completed: '✅', failed: '❌' };
  const duration = result.completedAt
    ? `${((result.completedAt - result.startedAt) / 1000).toFixed(1)}s`
    : `${((Date.now() - result.startedAt) / 1000).toFixed(1)}s`;
  return `${icon[result.status]} ${result.agent} (${result.status}) ${duration}`;
}
