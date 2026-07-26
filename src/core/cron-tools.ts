/**
 * Cron tools — scheduled task management.
 */

export interface CronJob {
  id: string;
  name: string;
  schedule: string; // cron expression
  command: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  sessionId?: string;
}

// Registered cron jobs
const cronJobs = new Map<string, CronJob>();

/**
 * Register a cron job.
 */
export function registerCronJob(job: CronJob): void {
  cronJobs.set(job.id, job);
}

/**
 * Unregister a cron job.
 */
export function unregisterCronJob(id: string): boolean {
  return cronJobs.delete(id);
}

/**
 * Get all registered cron jobs.
 */
export function getCronJobs(): CronJob[] {
  return [...cronJobs.values()];
}

/**
 * Get a cron job by ID.
 */
export function getCronJob(id: string): CronJob | undefined {
  return cronJobs.get(id);
}

/**
 * Enable/disable a cron job.
 */
export function toggleCronJob(id: string, enabled: boolean): boolean {
  const job = cronJobs.get(id);
  if (!job) return false;
  job.enabled = enabled;
  return true;
}

/**
 * Parse a cron expression into its components.
 */
export function parseCronExpression(expr: string): { minute: string; hour: string; dayOfMonth: string; month: string; dayOfWeek: string } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return {
    minute: parts[0],
    hour: parts[1],
    dayOfMonth: parts[2],
    month: parts[3],
    dayOfWeek: parts[4],
  };
}

/**
 * Format a cron job for display.
 */
export function formatCronJob(job: CronJob): string {
  const status = job.enabled ? '✅' : '⏸️';
  const lastRun = job.lastRun ? new Date(job.lastRun).toLocaleString() : 'never';
  return `${status} ${job.name} (${job.schedule}) — last: ${lastRun}`;
}

/**
 * Get cron jobs for a session.
 */
export function getSessionCronJobs(sessionId: string): CronJob[] {
  return [...cronJobs.values()].filter(j => j.sessionId === sessionId);
}
