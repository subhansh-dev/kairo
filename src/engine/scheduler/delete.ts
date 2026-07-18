/**
 * SchedulerDeleteTool — cancels a scheduled task by ID.
 *
 */

export const SCHEDULER_DELETE_TOOL_NAME = 'scheduler_delete';

export interface SchedulerDeleteInput {
  id: string;
}

export interface SchedulerDeleteOutput {
  success: boolean;
  message: string;
}
