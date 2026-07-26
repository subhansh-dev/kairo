/**
 * SchedulerCreateTool — creates scheduled recurring or one-shot tasks.
 *
 */

import { parseInterval } from './interval';
import {
  ScheduledTask,
  SchedulerCommand,
  createScheduledTask,
} from './types';

export interface SchedulerCreateInput {
  interval: string;
  prompt: string;
  recurring?: boolean;
  durable?: boolean;
  fireImmediately?: boolean;
}

export interface SchedulerCreateOutput {
  id: string;
  humanSchedule: string;
  recurring: boolean;
}

export const SCHEDULER_CREATE_TOOL_NAME = 'scheduler_create';

export const LOOP_SCHEDULE_INSTRUCTION = `
Create a scheduled task that runs a prompt on a recurring interval.

Set fire_immediately: true to also fire once on creation; by default the first run waits for the interval.

Usage notes:
- Interval format: "5m" (minutes), "2h" (hours), "1d" (days), "60s" (seconds, min 60)
- Maximum 50 scheduled tasks at once
- Recurring tasks auto-expire after 7 days
`.trim();

export const LOOP_USAGE_MESSAGE = `
Usage: scheduler_create({ interval: "5m", prompt: "check deploy status" })
  interval: Time between executions (e.g. "5m", "2h", "1d")
  prompt: The prompt text to execute on each scheduled fire
  recurring: Whether the task repeats (default: true)
  durable: Whether the task persists across sessions (default: false)
  fireImmediately: Whether to fire immediately on creation (default: false)
`.trim();
