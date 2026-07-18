/**
 * Workspace telemetry event types.
 *
 * Stable telemetry target for workspace events.
 */

export const TELEMETRY_TARGET = 'workspace::telemetry';

export type TelemetryPhase =
  | 'tool_state'
  | 'environment'
  | 'drain'
  | 'session'
  | 'permission'
  | 'checkpoint';

export interface TelemetryEvent {
  sessionId?: string;
  turnNumber?: number;
  phase: TelemetryPhase;
  bytes?: number;
  fileCount?: number;
  pending?: number;
  pendingBytes?: number;
  samplePeriodSecs?: number;
  errorCategory?: string;
  outcome?: string;
  skipReason?: string;
  drainReason?: string;
  graceMs?: number;
  activeAtStart?: number;
  pendingAtStart?: number;
  producersAtStart?: number;
  message?: string;
}

/**
 * Emit a telemetry event (logs to console in development).
 */
export function emitTelemetry(event: TelemetryEvent): void {
  if (process.env['KAIRO_TELEMETRY'] === 'false') return;

  const logEntry = {
    target: TELEMETRY_TARGET,
    timestamp: Date.now(),
    ...event,
  };

  if (process.env['KAIRO_TELEMETRY_DEBUG']) {
    console.log(JSON.stringify(logEntry));
  }
}

/**
 * Emit a tool state telemetry event.
 */
export function emitToolStateEvent(
  sessionId: string,
  turnNumber: number,
  outcome: string,
  details?: Partial<TelemetryEvent>
): void {
  emitTelemetry({
    sessionId,
    turnNumber,
    phase: 'tool_state',
    outcome,
    ...details,
  });
}

/**
 * Emit a drain telemetry event.
 */
export function emitDrainEvent(
  drainReason: string,
  graceMs: number,
  activeAtStart: number,
  pendingAtStart: number,
  producersAtStart: number,
  outcome: string
): void {
  emitTelemetry({
    phase: 'drain',
    drainReason,
    graceMs,
    activeAtStart,
    pendingAtStart,
    producersAtStart,
    outcome,
  });
}
