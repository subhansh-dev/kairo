/**
 * SchedulerActor — manages scheduled tasks with fire-next semantics.
 *
 */

import {
  ScheduledTask,
  SchedulerCommand,
  SchedulerState,
  createScheduledTask,
  nextFireAt,
  isExpired,
  isMissed,
} from './types';
import { intervalToHuman } from './interval';

export interface SchedulerNotificationHandle {
  sendTaskCreated(data: {
    taskId: string;
    prompt: string;
    humanSchedule: string;
    nextFireAt?: string;
  }): void;
  sendTaskFired(data: {
    taskId: string;
    prompt: string;
    humanSchedule: string;
  }): void;
  sendTaskRemoved(data: { taskId: string }): void;
}

export class SchedulerActor {
  private tasks: ScheduledTask[] = [];
  private cmdQueue: SchedulerCommand[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private notificationHandle: SchedulerNotificationHandle;
  private onFire: (prompt: string) => Promise<void>;
  private maxTasks: number;

  constructor(opts: {
    notificationHandle: SchedulerNotificationHandle;
    onFire: (prompt: string) => Promise<void>;
    maxTasks?: number;
    initialTasks?: ScheduledTask[];
  }) {
    this.notificationHandle = opts.notificationHandle;
    this.onFire = opts.onFire;
    this.maxTasks = opts.maxTasks ?? 50;
    if (opts.initialTasks) {
      this.tasks = opts.initialTasks;
    }
  }

  getState(): SchedulerState {
    return { tasks: [...this.tasks] };
  }

  sendCommand(cmd: SchedulerCommand): void {
    this.cmdQueue.push(cmd);
    this.processQueue();
  }

  private processQueue(): void {
    while (this.cmdQueue.length > 0) {
      const cmd = this.cmdQueue.shift()!;
      switch (cmd.type) {
        case 'create':
          this.handleCreate(cmd);
          break;
        case 'delete':
          this.handleDelete(cmd);
          break;
        case 'list':
          cmd.reply([...this.tasks]);
          break;
      }
    }
  }

  private handleCreate(cmd: SchedulerCommand): void {
    if (cmd.type !== 'create') return;

    if (this.tasks.length >= this.maxTasks) {
      cmd.reply({ ok: false, error: `maximum of ${this.maxTasks} scheduled tasks reached` });
      return;
    }

    this.tasks.push(cmd.task);

    this.notificationHandle.sendTaskCreated({
      taskId: cmd.task.id,
      prompt: cmd.task.prompt,
      humanSchedule: intervalToHuman(cmd.task.intervalSecs),
      nextFireAt: nextFireAt(cmd.task).toISOString(),
    });

    cmd.reply({ ok: true, task: cmd.task });
    this.scheduleNext();
  }

  private handleDelete(cmd: SchedulerCommand): void {
    if (cmd.type !== 'delete') return;

    const idx = this.tasks.findIndex(t => t.id === cmd.id);
    if (idx >= 0) {
      this.tasks.splice(idx, 1);
      this.notificationHandle.sendTaskRemoved({ taskId: cmd.id });
      cmd.reply(true);
      this.scheduleNext();
    } else {
      cmd.reply(false);
    }
  }

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.tasks.length === 0) return;

    const now = new Date();
    let minDelay = Infinity;

    for (const task of this.tasks) {
      const fireAt = nextFireAt(task);
      const delay = fireAt.getTime() - now.getTime();
      if (delay < minDelay) {
        minDelay = delay;
      }
    }

    if (minDelay <= 0) {
      this.fireNextTask();
    } else {
      this.timer = setTimeout(() => this.fireNextTask(), Math.min(minDelay, 2147483647));
    }
  }

  private fireNextTask(): void {
    const now = new Date();
    const idx = this.tasks.findIndex(t => nextFireAt(t) <= now);

    if (idx < 0) {
      this.scheduleNext();
      return;
    }

    const task = this.tasks[idx];
    const taskId = task.id;
    const prompt = task.prompt;
    const humanSchedule = intervalToHuman(task.intervalSecs);

    // Advance last_fired_at
    task.lastFiredAt = now.toISOString();

    let shouldRemove = false;
    if (!task.recurring) {
      shouldRemove = true;
    } else if (isExpired(task, now)) {
      shouldRemove = true;
    }

    if (shouldRemove) {
      this.tasks.splice(idx, 1);
      this.notificationHandle.sendTaskRemoved({ taskId });
    }

    this.notificationHandle.sendTaskFired({
      taskId,
      prompt,
      humanSchedule,
    });

    // Fire asynchronously — don't block the scheduler
    this.onFire(prompt).catch(err => {
      console.error(`[SchedulerActor] Error firing task ${taskId}:`, err);
    });

    this.scheduleNext();
  }

  start(): void {
    this.running = true;
    // Handle missed tasks
    const now = new Date();
    for (const task of [...this.tasks]) {
      if (isMissed(task, now)) {
        task.lastFiredAt = now.toISOString();
        this.onFire(task.prompt).catch(() => {});
        if (!task.recurring) {
          const idx = this.tasks.indexOf(task);
          if (idx >= 0) this.tasks.splice(idx, 1);
        }
      }
    }
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Notify removal of all remaining tasks
    for (const task of this.tasks) {
      this.notificationHandle.sendTaskRemoved({ taskId: task.id });
    }
    this.tasks = [];
  }
}
