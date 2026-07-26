/**
 * Exit plan mode tool — signals plan mode exit and presents plan.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export const EXIT_PLAN_MODE_TOOL_NAME = 'exit_plan_mode';

export interface ExitPlanModeInput {}

export interface ExitPlanModeOutput {
  planContent: string;
  planFilePath: string;
}

export interface ExitPlanModeExtRequest {
  sessionId: string;
  planContent: string;
}

export interface ExitPlanModeExtResponse {
  approved: boolean;
  feedback?: string;
}

/**
 * Read the plan file from disk.
 */
export async function readPlanFile(planFilePath: string): Promise<string> {
  try {
    return await fs.readFile(planFilePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Default plan file path.
 */
export function defaultPlanPath(cwd: string): string {
  return path.join(cwd, '.kairo', 'plan.md');
}

export const EXIT_PLAN_MODE_DESCRIPTION = `
Exit plan mode and present your plan to the user.
Use this after you have finished writing your plan to the plan file in plan mode.
`.trim();
