/**
 * Kairo — Cron/Scheduling Tool
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ToolDefinition, ToolResult } from './types.js';

const CRON_DIR = join(homedir(), '.kairo', 'cron');

interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  recurring: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
  enabled: boolean;
}

function ensureCronDir() {
  if (!existsSync(CRON_DIR)) mkdirSync(CRON_DIR, { recursive: true });
}

function loadJobs(): CronJob[] {
  ensureCronDir();
  const file = join(CRON_DIR, 'jobs.json');
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function saveJobs(jobs: CronJob[]) {
  ensureCronDir();
  writeFileSync(join(CRON_DIR, 'jobs.json'), JSON.stringify(jobs, null, 2));
}

export const cronTool: ToolDefinition = {
  name: 'cron',
  description: 'Manage scheduled tasks. Usage: cron create|list|delete|trigger <args>',
  prompt: `Schedule recurring or one-shot tasks.

Usage:
- cron create <schedule> <prompt> — create a new scheduled task
  Schedule format: "*/5 * * * *" (cron) or "5m" (interval) or "once" (one-shot)
- cron list — list all scheduled tasks
- cron delete <id> — delete a scheduled task
- cron trigger <id> — trigger a task immediately
- cron enable <id> — enable a task
- cron disable <id> — disable a task`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const parts = args.split(/\s+/);
      const action = parts[0]?.toLowerCase();
      const rest = parts.slice(1).join(' ');

      const jobs = loadJobs();

      switch (action) {
        case 'create': {
          const spaceIdx = rest.indexOf(' ');
          if (spaceIdx === -1) return { output: 'Usage: cron create <schedule> <prompt>', success: false };
          const schedule = rest.slice(0, spaceIdx);
          const prompt = rest.slice(spaceIdx + 1);
          const id = Date.now().toString(36);
          const job: CronJob = {
            id,
            schedule,
            prompt,
            recurring: schedule !== 'once',
            createdAt: new Date().toISOString(),
            enabled: true,
          };
          jobs.push(job);
          saveJobs(jobs);
          return { output: `Created job ${id}: "${schedule}" → ${prompt.slice(0, 50)}...`, success: true };
        }

        case 'list': {
          if (jobs.length === 0) return { output: 'No scheduled jobs.', success: true };
          const list = jobs.map(j => {
            const status = j.enabled ? '●' : '○';
            const recur = j.recurring ? '↻' : '1x';
            return `${status} ${j.id} [${j.schedule}] ${recur} — ${j.prompt.slice(0, 60)}`;
          }).join('\n');
          return { output: list, success: true };
        }

        case 'delete': {
          const idx = jobs.findIndex(j => j.id === rest);
          if (idx === -1) return { output: `Job not found: ${rest}`, success: false };
          jobs.splice(idx, 1);
          saveJobs(jobs);
          return { output: `Deleted job ${rest}`, success: true };
        }

        case 'trigger': {
          const job = jobs.find(j => j.id === rest);
          if (!job) return { output: `Job not found: ${rest}`, success: false };
          job.lastRun = new Date().toISOString();
          saveJobs(jobs);
          return { output: `Triggered job ${rest}: ${job.prompt}`, success: true, metadata: { job } };
        }

        case 'enable': {
          const job = jobs.find(j => j.id === rest);
          if (!job) return { output: `Job not found: ${rest}`, success: false };
          job.enabled = true;
          saveJobs(jobs);
          return { output: `Enabled job ${rest}`, success: true };
        }

        case 'disable': {
          const job = jobs.find(j => j.id === rest);
          if (!job) return { output: `Job not found: ${rest}`, success: false };
          job.enabled = false;
          saveJobs(jobs);
          return { output: `Disabled job ${rest}`, success: true };
        }

        default:
          return { output: 'Usage: cron create|list|delete|trigger|enable|disable <args>', success: false };
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
