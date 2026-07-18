/**
 * Agent lifecycle — hooks for agent startup, shutdown, and state transitions.
 */

export type LifecyclePhase = 'init' | 'ready' | 'running' | 'pausing' | 'paused' | 'stopping' | 'stopped' | 'error';

export interface LifecycleEvent {
  phase: LifecyclePhase;
  timestamp: Date;
  data?: Record<string, unknown>;
  error?: string;
}

export type LifecycleHook = (event: LifecycleEvent) => void | Promise<void>;

export interface AgentLifecycle {
  phase: LifecyclePhase;
  hooks: Map<LifecyclePhase, LifecycleHook[]>;
  history: LifecycleEvent[];
  on(phase: LifecyclePhase, hook: LifecycleHook): void;
  off(phase: LifecyclePhase, hook: LifecycleHook): void;
  transition(to: LifecyclePhase, data?: Record<string, unknown>): Promise<void>;
}

/**
 * Create an agent lifecycle manager.
 */
export function createLifecycle(): AgentLifecycle {
  const lifecycle: AgentLifecycle = {
    phase: 'init',
    hooks: new Map(),
    history: [],

    on(phase, hook) {
      const existing = lifecycle.hooks.get(phase) ?? [];
      existing.push(hook);
      lifecycle.hooks.set(phase, existing);
    },

    off(phase, hook) {
      const existing = lifecycle.hooks.get(phase) ?? [];
      lifecycle.hooks.set(phase, existing.filter(h => h !== hook));
    },

    async transition(to, data) {
      const from = lifecycle.phase;
      const event: LifecycleEvent = {
        phase: to,
        timestamp: new Date(),
        data: { ...data, from },
      };

      lifecycle.history.push(event);
      lifecycle.phase = to;

      const hooks = lifecycle.hooks.get(to) ?? [];
      for (const hook of hooks) {
        try {
          await hook(event);
        } catch (error) {
          event.error = error instanceof Error ? error.message : String(error);
        }
      }
    },
  };

  return lifecycle;
}

/**
 * Standard lifecycle validation — checks valid transitions.
 */
export function isValidTransition(from: LifecyclePhase, to: LifecyclePhase): boolean {
  const validTransitions: Record<LifecyclePhase, LifecyclePhase[]> = {
    init: ['ready', 'error'],
    ready: ['running', 'stopping'],
    running: ['pausing', 'stopping', 'error'],
    pausing: ['paused', 'running', 'error'],
    paused: ['running', 'stopping'],
    stopping: ['stopped', 'error'],
    stopped: [],
    error: ['init', 'stopping'],
  };

  return validTransitions[from]?.includes(to) ?? false;
}

/**
 * Get lifecycle history as a formatted string.
 */
export function formatLifecycleHistory(history: LifecycleEvent[]): string {
  return history
    .map(e => `[${e.timestamp.toISOString()}] ${e.phase}${e.error ? ` (error: ${e.error})` : ''}`)
    .join('\n');
}
