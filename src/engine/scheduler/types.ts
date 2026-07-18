/**
 * Scheduler types — ScheduledTask, SchedulerCommand, SchedulerState.
 *
 */

export interface ScheduledTask {
  id: string;
  intervalSecs: number;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  createdAt: string; // ISO 8601
  lastFiredAt?: string;
  expiresAt?: string;
}

export function createScheduledTask(
  intervalSecs: number,
  prompt: string,
  recurring: boolean,
  durable: boolean,
  fireImmediately = false
): ScheduledTask {
  const now = new Date();
  // When fire_immediately is true, anchor created_at in the past so next_fire_at = now
  const createdAt = fireImmediately
    ? new Date(now.getTime() - intervalSecs * 1000).toISOString()
    : now.toISOString();

  return {
    id: generateTaskId(),
    intervalSecs,
    prompt,
    recurring,
    durable,
    createdAt,
    expiresAt: recurring
      ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : undefined,
  };
}

export function nextFireAt(task: ScheduledTask): Date {
  const anchor = task.lastFiredAt
    ? new Date(task.lastFiredAt)
    : new Date(task.createdAt);
  return new Date(anchor.getTime() + task.intervalSecs * 1000);
}

export function isExpired(task: ScheduledTask, now: Date): boolean {
  return task.expiresAt ? now >= new Date(task.expiresAt) : false;
}

export function isMissed(task: ScheduledTask, now: Date): boolean {
  return !task.recurring && !task.lastFiredAt && nextFireAt(task) < now;
}

export interface SchedulerState {
  tasks: ScheduledTask[];
}

export interface SchedulerCommandCreate {
  type: 'create';
  task: ScheduledTask;
  reply: (result: { ok: boolean; task?: ScheduledTask; error?: string }) => void;
}

export interface SchedulerCommandDelete {
  type: 'delete';
  id: string;
  reply: (found: boolean) => void;
}

export interface SchedulerCommandList {
  type: 'list';
  reply: (tasks: ScheduledTask[]) => void;
}

export type SchedulerCommand =
  | SchedulerCommandCreate
  | SchedulerCommandDelete
  | SchedulerCommandList;

let taskCounter = 0;

function generateTaskId(): string {
  taskCounter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `${ts}${rand}${taskCounter}`.substring(0, 12);
}
