/**
 * SchedulerListTool — lists all active scheduled tasks.
 *
 */

export const SCHEDULER_LIST_TOOL_NAME = 'scheduler_list';

export interface SchedulerListInput {}

export interface ScheduledTaskSummary {
  id: string;
  prompt: string;
  intervalHuman: string;
  nextFireAt: string;
  createdAt: string;
  recurring: boolean;
}

export interface SchedulerListOutput {
  tasks: ScheduledTaskSummary[];
}
