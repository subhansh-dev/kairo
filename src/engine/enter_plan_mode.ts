/**
 * Enter plan mode tool — signals plan mode entry.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export const ENTER_PLAN_MODE_TOOL_NAME = 'enter_plan_mode';

export interface EnterPlanModeInput {}

export interface EnterPlanModeOutput {
  planFileSeeded: boolean;
  planFilePath: string;
}

export interface PlanFileSeedStatus {
  seeded: boolean;
  existed: boolean;
}

/**
 * Seed the plan file if it doesn't exist.
 */
export async function seedPlanFile(planFilePath: string): Promise<PlanFileSeedStatus> {
  try {
    await fs.access(planFilePath);
    return { seeded: false, existed: true };
  } catch {
    // File doesn't exist — create it
    await fs.mkdir(path.dirname(planFilePath), { recursive: true });
    await fs.writeFile(planFilePath, '# Implementation Plan\n\n', 'utf-8');
    return { seeded: true, existed: false };
  }
}

export const ENTER_PLAN_MODE_DESCRIPTION = `
Use this tool when a task has ambiguity about the right approach or when the user asks you to write a plan.
This tool enables a read-only plan mode where you explore the codebase and create an implementation plan for the user.
`.trim();
