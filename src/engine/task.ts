/**
 * Task tool — launches subagents to handle tasks autonomously.
 *
 */

export interface TaskToolInput {
  taskId?: string;
  prompt: string;
  description: string;
  subagentType?: string;
  model?: string;
  cwd?: string;
  runInBackground?: boolean;
  capabilityMode?: string;
  isolation?: string;
}

export interface SubagentRequest {
  id: string;
  prompt: string;
  description: string;
  subagentType: string;
  parentSessionId: string;
  parentPromptId?: string;
  resumeFrom?: string;
  cwd?: string;
  runtimeOverrides: SubagentRuntimeOverrides;
  runInBackground: boolean;
  surfaceCompletion: boolean;
  forkContext: boolean;
}

export interface SubagentRuntimeOverrides {
  model?: string;
  reasoningEffort?: string;
  persona?: string;
  capabilityMode?: string;
  isolation?: string;
}

export interface SubagentResult {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  output: string;
  error?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface SubagentSnapshot {
  taskId: string;
  status: SubagentSnapshotStatus;
  prompt: string;
  description: string;
  subagentType: string;
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

export enum SubagentSnapshotStatus {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export const MAX_SUBAGENT_DEPTH = 1;
export const TASK_TOOL_NAME = 'task';

export interface TaskBackend {
  spawn(request: SubagentRequest): Promise<SubagentResult>;
  query(taskId: string): Promise<SubagentSnapshot>;
  cancel(taskId: string): Promise<void>;
}

/**
 * TaskTool implementation — manages subagent lifecycle.
 */
export class TaskTool {
  private backend: TaskBackend;
  private depthCounter = 0;
  private parentSessionId: string;

  constructor(backend: TaskBackend, parentSessionId: string) {
    this.backend = backend;
    this.parentSessionId = parentSessionId;
  }

  async execute(input: TaskToolInput): Promise<SubagentResult> {
    if (this.depthCounter >= MAX_SUBAGENT_DEPTH) {
      return {
        taskId: input.taskId || '',
        status: 'failed',
        output: '',
        error: 'Maximum subagent nesting depth exceeded',
      };
    }

    const taskId = input.taskId || generateTaskId();
    this.depthCounter++;

    try {
      const request: SubagentRequest = {
        id: taskId,
        prompt: input.prompt,
        description: input.description,
        subagentType: input.subagentType || 'general',
        parentSessionId: this.parentSessionId,
        cwd: input.cwd,
        runtimeOverrides: {
          model: input.model,
          capabilityMode: input.capabilityMode,
          isolation: input.isolation,
        },
        runInBackground: input.runInBackground ?? false,
        surfaceCompletion: true,
        forkContext: false,
      };

      return await this.backend.spawn(request);
    } finally {
      this.depthCounter--;
    }
  }
}

let taskCounter = 0;

function generateTaskId(): string {
  taskCounter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `${ts}${rand}${taskCounter}`;
}
