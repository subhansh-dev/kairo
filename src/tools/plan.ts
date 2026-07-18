/**
 * Kairo — Plan Mode Tools
 * 
 * Explore codebase in read-only, write plan, get approval, then code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ToolDefinition, ToolResult } from './types.js';

// ─── Plan State ─────────────────────────────────────────────────

interface PlanState {
  active: boolean;
  planFile: string | null;
  approved: boolean;
  steps: string[];
}

const PLAN_DIR = join(homedir(), '.kairo', 'plans');
let planState: PlanState = { active: false, planFile: null, approved: false, steps: [] };

function ensurePlanDir() {
  if (!existsSync(PLAN_DIR)) mkdirSync(PLAN_DIR, { recursive: true });
}

// ─── Enter Plan Mode ────────────────────────────────────────────

export const enterPlanModeTool: ToolDefinition = {
  name: 'enter_plan_mode',
  description: 'Enter plan mode — explore codebase and create a plan before coding',
  prompt: `Enter planning mode. In this mode:
1. Explore the codebase (read-only)
2. Create an implementation plan
3. Present the plan for approval
4. Exit plan mode to start coding

Use this before complex tasks to ensure a structured approach.`,
  tier: 'read',
  concurrencySafe: false,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    planState = {
      active: true,
      planFile: null,
      approved: false,
      steps: [],
    };

    return {
      output: `Entered plan mode. Explore the codebase and create a plan.\nUse "write_plan <steps>" to create your plan.\nUse "exit_plan_mode" when done.`,
      success: true,
      metadata: { mode: 'plan' },
    };
  },
};

// ─── Write Plan ─────────────────────────────────────────────────

export const writePlanTool: ToolDefinition = {
  name: 'write_plan',
  description: 'Write an implementation plan. Usage: write_plan <plan content>',
  prompt: `Write an implementation plan with clear steps.

Format:
## Plan: [Task Name]
### Steps
1. [Step description]
2. [Step description]
### Files to modify
- file1.ts — what to change
- file2.ts — what to change
### Risks
- [Risk] — [Mitigation]`,
  tier: 'read',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    if (!planState.active) {
      return { output: 'Not in plan mode. Use "enter_plan_mode" first.', success: false };
    }

    ensurePlanDir();
    const planId = Date.now().toString(36);
    const planFile = join(PLAN_DIR, `plan-${planId}.md`);

    writeFileSync(planFile, args);
    planState.planFile = planFile;
    planState.steps = args.split('\n').filter(l => l.match(/^\d+\./));

    return {
      output: `Plan saved: ${planFile}\n${planState.steps.length} steps identified.\nUse "exit_plan_mode" to approve and start coding.`,
      success: true,
      metadata: { planFile, steps: planState.steps.length },
    };
  },
};

// ─── Exit Plan Mode ─────────────────────────────────────────────

export const exitPlanModeTool: ToolDefinition = {
  name: 'exit_plan_mode',
  description: 'Exit plan mode — approve the plan and start coding',
  prompt: `Exit planning mode and approve the plan for implementation.
After exiting, the agent will follow the plan steps to implement the solution.`,
  tier: 'read',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    if (!planState.active) {
      return { output: 'Not in plan mode.', success: false };
    }

    planState.active = false;
    planState.approved = true;

    const planInfo = planState.planFile
      ? `\nPlan: ${planState.planFile}\nSteps: ${planState.steps.length}`
      : '\nNo plan written.';

    return {
      output: `Plan approved. Starting implementation.${planInfo}`,
      success: true,
      metadata: { approved: true, planFile: planState.planFile, steps: planState.steps.length },
    };
  },
};

// ─── Get Plan Status ────────────────────────────────────────────

export function getPlanState(): PlanState {
  return { ...planState };
}

export function isInPlanMode(): boolean {
  return planState.active;
}
