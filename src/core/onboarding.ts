/**
 * Contextual first-touch onboarding hints.
 *
 * Shows one-time hints the first time a user hits a behavior fork.
 * Each hint is shown once per install and then never again.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Flag names (stable — used as config keys)
export const BUSY_INPUT_FLAG = 'busy_input_prompt';
export const TOOL_PROGRESS_FLAG = 'tool_progress_prompt';
export const PROFILE_BUILD_FLAG = 'profile_build_offered';
export const FIRST_TOOL_FLAG = 'first_tool_call';
export const FIRST_AGENT_FLAG = 'first_agent_spawn';

const CONFIG_FILE = join(homedir(), '.kairo', 'onboarding.json');

interface OnboardingState {
  seen: Record<string, boolean>;
}

/**
 * Load onboarding state from disk.
 */
function loadState(): OnboardingState {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch { /* ok */ }
  return { seen: {} };
}

/**
 * Save onboarding state to disk.
 */
function saveState(state: OnboardingState): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Check if a hint has been seen.
 */
export function hasSeenHint(flag: string): boolean {
  return loadState().seen[flag] === true;
}

/**
 * Mark a hint as seen.
 */
export function markHintSeen(flag: string): void {
  const state = loadState();
  state.seen[flag] = true;
  saveState(state);
}

/**
 * Show a hint if it hasn't been seen yet.
 * Returns the hint message or null if already seen.
 */
export function showHintOnce(flag: string, message: string): string | null {
  if (hasSeenHint(flag)) return null;
  markHintSeen(flag);
  return message;
}

/**
 * Get the busy-input hint for the CLI.
 */
export function getBusyInputHint(mode: string): string | null {
  const hints: Record<string, string> = {
    queue: '(tip) Your message was queued for the next turn. Use /busy interrupt to stop the current run instead. This tip only shows once.',
    steer: '(tip) Your message was steered into the current run; it arrives after the next tool call. This tip only shows once.',
    interrupt: '(tip) Your message interrupted the current run. Use /busy queue to queue messages instead. This tip only shows once.',
  };
  return showHintOnce(BUSY_INPUT_FLAG, hints[mode] || hints.interrupt);
}

/**
 * Get the first tool call hint.
 */
export function getFirstToolHint(): string | null {
  return showHintOnce(
    FIRST_TOOL_FLAG,
    '💡 Tip: Tools are executed automatically. Use Ctrl+C to interrupt if needed.',
  );
}

/**
 * Get the first agent spawn hint.
 */
export function getFirstAgentHint(): string | null {
  return showHintOnce(
    FIRST_AGENT_FLAG,
    '💡 Tip: Agents work in parallel. Use /agents to see the agent tree.',
  );
}

/**
 * Reset all onboarding hints (for testing).
 */
export function resetOnboarding(): void {
  saveState({ seen: {} });
}
