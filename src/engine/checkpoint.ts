/**
 * Session checkpoint management for rewind functionality.
 *
 * Handles filesystem snapshots, hunk tracking, and git state
 * at turn boundaries.
 */

import type { RewindPoint } from './file_state';

export interface RewindCheckpoint {
  promptIndex: number;
  fs: RewindPoint;
  hunks?: HunkTurnDelta;
}

export interface HunkTurnDelta {
  fileStates: Map<string, HunkFileState>;
}

export interface HunkFileState {
  path: string;
  added: number;
  removed: number;
  unchanged: number;
}

export type TurnBoundaryKind =
  | 'start'
  | 'end'
  | 'rewind_begin'
  | 'rewind_finalize';

export interface TurnBoundary {
  kind: TurnBoundaryKind;
  promptIndex?: number;
  turnNumber: number;
  durationMs?: number;
  outcome?: 'completed' | 'force_continue' | 'error';
  written?: string[];
}

/**
 * Create a turn start boundary.
 */
export function turnStart(turnNumber: number): TurnBoundary {
  return {
    kind: 'start',
    turnNumber,
  };
}

/**
 * Create a turn end boundary.
 */
export function turnEnd(
  turnNumber: number,
  durationMs: number,
  outcome: 'completed' | 'force_continue' | 'error',
  written: string[] = []
): TurnBoundary {
  return {
    kind: 'end',
    turnNumber,
    durationMs,
    outcome,
    written,
  };
}

/**
 * Create a rewind begin boundary.
 */
export function rewindBegin(promptIndex: number): TurnBoundary {
  return {
    kind: 'rewind_begin',
    promptIndex,
    turnNumber: promptIndex,
  };
}

/**
 * Create a rewind finalize boundary.
 */
export function rewindFinalize(promptIndex: number): TurnBoundary {
  return {
    kind: 'rewind_finalize',
    promptIndex,
    turnNumber: promptIndex,
    durationMs: 0,
    outcome: 'completed',
    written: [],
  };
}

/**
 * Check if rewind hunks feature is enabled.
 */
export function rewindHunksEnabled(): boolean {
  return process.env['KAIRO_REWIND_HUNKS'] === 'true';
}

/**
 * Check if durable rewind is enabled.
 */
export function rewindDurableEnabled(): boolean {
  return process.env['KAIRO_REWIND_DURABLE'] === 'true';
}
