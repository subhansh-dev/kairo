/**
 * Kairo — Agent Lifecycle
 * Host-agnostic agent lifecycle hooks.
 *
 * Lifecycle phases: session_start → turn_start → turn_done/turn_error → session_end
 */

// ─── Types ──────────────────────────────────────────────────────

export type LifecyclePhase = 'session_start' | 'turn_start' | 'turn_done' | 'turn_error' | 'turn_abort' | 'session_idle' | 'session_end';

export interface LifecycleEvent {
  phase: LifecyclePhase;
  timestamp: number;
  data: Record<string, any>;
}

export interface LifecycleHook {
  phase: LifecyclePhase;
  handler: (event: LifecycleEvent) => void | Promise<void>;
  priority: number; // lower = runs first
}

// ─── Session/Turn Tracking ─────────────────────────────────────

export interface AgentTurn {
  turnNumber: number;
  agent: string;
  role: string; // thinker/worker/verifier
  model: string;
  provider: string;
  toolCalls: string[];
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed';
}

export interface AgentSession {
  sessionId: string;
  startedAt: number;
  turns: AgentTurn[];
  totalTools: number;
  totalTokens: number;
}

const sessions = new Map<string, AgentSession>();
let currentSession: AgentSession | null = null;
let currentTurn: AgentTurn | null = null;
let sessionIdCounter = 0;

/**
 * Start a new agent session.
 */
export function startSession(): AgentSession {
  const id = `session_${Date.now()}_${sessionIdCounter++}`;
  const session: AgentSession = {
    sessionId: id,
    startedAt: Date.now(),
    turns: [],
    totalTools: 0,
    totalTokens: 0,
  };
  sessions.set(id, session);
  currentSession = session;
  getLifecycleRegistry().dispatch('session_start', { sessionId: id });
  return session;
}

/**
 * End the current agent session.
 */
export function endSession(): void {
  if (currentSession) {
    getLifecycleRegistry().dispatch('session_end', { sessionId: currentSession.sessionId });
    currentSession = null;
    currentTurn = null;
  }
}

/**
 * Start a new turn within the current session.
 */
export function startTurn(agent: string, role: string, model: string, provider: string): AgentTurn {
  const turn: AgentTurn = {
    turnNumber: currentSession ? currentSession.turns.length + 1 : 0,
    agent,
    role,
    model,
    provider,
    toolCalls: [],
    startTime: Date.now(),
    status: 'running',
  };
  currentTurn = turn;
  if (currentSession) currentSession.turns.push(turn);
  getLifecycleRegistry().dispatch('turn_start', { turn: turn.turnNumber, agent, role, model });
  return turn;
}

/**
 * Record a tool call within the current turn.
 */
export function recordToolCall(toolName: string): void {
  if (currentTurn) {
    currentTurn.toolCalls.push(toolName);
  }
  if (currentSession) {
    currentSession.totalTools++;
  }
}

/**
 * Record tokens used in the current session.
 */
export function recordTokens(inputTokens: number, outputTokens: number): void {
  if (currentSession) {
    currentSession.totalTokens += inputTokens + outputTokens;
  }
}

/**
 * End the current turn.
 */
export function endTurn(status: 'completed' | 'failed'): void {
  if (currentTurn) {
    currentTurn.status = status;
    currentTurn.endTime = Date.now();
    const phase = status === 'completed' ? 'turn_done' : 'turn_error';
    getLifecycleRegistry().dispatch(phase, {
      turn: currentTurn.turnNumber,
      agent: currentTurn.agent,
      duration: currentTurn.endTime - currentTurn.startTime,
      toolCount: currentTurn.toolCalls.length,
    });
    currentTurn = null;
  }
}

/**
 * Get the current session.
 */
export function getCurrentSession(): AgentSession | null {
  return currentSession;
}

/**
 * Get the current turn.
 */
export function getCurrentTurn(): AgentTurn | null {
  return currentTurn;
}

/**
 * Get all sessions.
 */
export function getAllSessions(): AgentSession[] {
  return [...sessions.values()];
}

/**
 * Reset lifecycle state (for testing).
 */
export function resetLifecycle(): void {
  sessions.clear();
  currentSession = null;
  currentTurn = null;
  sessionIdCounter = 0;
}

// ─── Registry ───────────────────────────────────────────────────

export class LifecycleRegistry {
  private hooks: LifecycleHook[] = [];

  /**
   * Register a lifecycle hook.
   */
  register(hook: LifecycleHook): void {
    this.hooks.push(hook);
    this.hooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Unregister a lifecycle hook.
   */
  unregister(phase: LifecyclePhase, handler: (event: LifecycleEvent) => void | Promise<void>): void {
    this.hooks = this.hooks.filter(h => !(h.phase === phase && h.handler === handler));
  }

  /**
   * Dispatch a lifecycle event.
   */
  async dispatch(phase: LifecyclePhase, data: Record<string, any> = {}): Promise<void> {
    const event: LifecycleEvent = { phase, timestamp: Date.now(), data };
    for (const hook of this.hooks) {
      if (hook.phase === phase) {
        try {
          await hook.handler(event);
        } catch (e) {
          // Hooks are fail-open
        }
      }
    }
  }

  /**
   * Get hooks for a phase.
   */
  getHooks(phase: LifecyclePhase): LifecycleHook[] {
    return this.hooks.filter(h => h.phase === phase);
  }
}

// ─── Convenience ────────────────────────────────────────────────

let registry: LifecycleRegistry | null = null;

export function getLifecycleRegistry(): LifecycleRegistry {
  if (!registry) registry = new LifecycleRegistry();
  return registry;
}

export function onSessionStart(handler: (event: LifecycleEvent) => void | Promise<void>, priority: number = 100): void {
  getLifecycleRegistry().register({ phase: 'session_start', handler, priority });
}

export function onTurnStart(handler: (event: LifecycleEvent) => void | Promise<void>, priority: number = 100): void {
  getLifecycleRegistry().register({ phase: 'turn_start', handler, priority });
}

export function onTurnDone(handler: (event: LifecycleEvent) => void | Promise<void>, priority: number = 100): void {
  getLifecycleRegistry().register({ phase: 'turn_done', handler, priority });
}

export function onTurnError(handler: (event: LifecycleEvent) => void | Promise<void>, priority: number = 100): void {
  getLifecycleRegistry().register({ phase: 'turn_error', handler, priority });
}

export function onSessionEnd(handler: (event: LifecycleEvent) => void | Promise<void>, priority: number = 100): void {
  getLifecycleRegistry().register({ phase: 'session_end', handler, priority });
}
