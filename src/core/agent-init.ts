/**
 * Agent initialization helpers.
 *
 * Sets up agent state: context engine, tool guardrails, think scrubber,
 * subdirectory hints, iteration budget, and other per-session state.
 */

import { SubdirectoryHintTracker } from './subdirectory-hints.js';
import { StreamingThinkScrubber } from './think-scrubber.js';
import { IterationBudget } from './iteration-budget.js';
import { ToolCallGuardrailController, type ToolCallGuardrailConfig } from './tool-guardrails.js';

export interface AgentInitState {
  // Core state
  sessionId: string;
  model: string;
  provider: string;
  maxIterations: number;

  // Components
  subdirectoryHintTracker: SubdirectoryHintTracker;
  thinkScrubber: StreamingThinkScrubber;
  iterationBudget: IterationBudget;
  guardrails: ToolCallGuardrailController;

  // Turn state
  turnCount: number;
  userTurnCount: number;
  toolCallCount: number;
  currentTurnId: string | null;

  // Memory state
  turnsSinceMemory: number;
  memoryNudgeInterval: number;

  // Streaming state
  streamCallback: ((text: string) => void) | null;
  interruptRequested: boolean;
  interruptMessage: string | null;

  // Cached state
  cachedSystemPrompt: string | null;
}

/**
 * Create a fresh agent initialization state.
 */
export function createAgentState(opts: {
  sessionId?: string;
  model?: string;
  provider?: string;
  maxIterations?: number;
  workingDir?: string;
  memoryNudgeInterval?: number;
  guardrailConfig?: Partial<ToolCallGuardrailConfig>;
}): AgentInitState {
  return {
    sessionId: opts.sessionId || `session_${Date.now()}`,
    model: opts.model || 'unknown',
    provider: opts.provider || 'unknown',
    maxIterations: opts.maxIterations || 50,

    subdirectoryHintTracker: new SubdirectoryHintTracker(opts.workingDir),
    thinkScrubber: new StreamingThinkScrubber(),
    iterationBudget: new IterationBudget(opts.maxIterations || 50),
    guardrails: new ToolCallGuardrailController(opts.guardrailConfig),

    turnCount: 0,
    userTurnCount: 0,
    toolCallCount: 0,
    currentTurnId: null,

    turnsSinceMemory: 0,
    memoryNudgeInterval: opts.memoryNudgeInterval || 10,

    streamCallback: null,
    interruptRequested: false,
    interruptMessage: null,

    cachedSystemPrompt: null,
  };
}

/**
 * Reset turn-level state for a new turn.
 */
export function resetTurnState(state: AgentInitState): void {
  state.thinkScrubber.reset();
  state.guardrails.resetForTurn();
  state.turnCount++;
  state.toolCallCount = 0;
  state.currentTurnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  state.turnsSinceMemory++;
}

/**
 * Check if a memory nudge should fire.
 */
export function shouldNudgeMemory(state: AgentInitState): boolean {
  if (state.memoryNudgeInterval <= 0) return false;
  return state.turnsSinceMemory >= state.memoryNudgeInterval;
}

/**
 * Reset the memory nudge counter.
 */
export function resetMemoryNudge(state: AgentInitState): void {
  state.turnsSinceMemory = 0;
}

/**
 * Request an interrupt.
 */
export function requestInterrupt(state: AgentInitState, message?: string): void {
  state.interruptRequested = true;
  state.interruptMessage = message || 'Interrupted by user';
}

/**
 * Clear interrupt state.
 */
export function clearInterrupt(state: AgentInitState): void {
  state.interruptRequested = false;
  state.interruptMessage = null;
}

/**
 * Get a summary of the agent state for display.
 */
export function formatAgentState(state: AgentInitState): string {
  return [
    `Session: ${state.sessionId}`,
    `Model: ${state.provider}/${state.model}`,
    `Turn: ${state.turnCount}`,
    `Tools: ${state.toolCallCount}`,
    `Budget: ${state.iterationBudget.stats.used}/${state.iterationBudget.stats.max}`, 
  ].join(' | ');
}
