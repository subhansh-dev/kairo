/**
 * Interrupt handling — manage user interrupts gracefully.
 */

export interface InterruptState {
  requested: boolean;
  message: string | null;
  requestedAt: number | null;
  threadId: number | null;
}

let interruptState: InterruptState = {
  requested: false,
  message: null,
  requestedAt: null,
  threadId: null,
};

/**
 * Request an interrupt.
 */
export function requestInterrupt(message?: string): void {
  interruptState = {
    requested: true,
    message: message || 'Interrupted by user',
    requestedAt: Date.now(),
    threadId: null,
  };
}

/**
 * Check if an interrupt has been requested.
 */
export function isInterrupted(): boolean {
  return interruptState.requested;
}

/**
 * Get the interrupt state.
 */
export function getInterruptState(): InterruptState {
  return { ...interruptState };
}

/**
 * Clear the interrupt state.
 */
export function clearInterrupt(): void {
  interruptState = {
    requested: false,
    message: null,
    requestedAt: null,
    threadId: null,
  };
}

/**
 * Get the interrupt message.
 */
export function getInterruptMessage(): string | null {
  return interruptState.requested ? interruptState.message : null;
}

/**
 * Check interrupt and throw if requested.
 */
export function checkInterrupt(): void {
  if (interruptState.requested) {
    throw new Error(interruptState.message || 'Interrupted');
  }
}
