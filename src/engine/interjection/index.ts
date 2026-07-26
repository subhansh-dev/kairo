/**
 * Interjection — event buffering and formatting for tool output interjection.
 */

export interface InterjectionEvent {
  id: string;
  type: 'tool_output' | 'status' | 'error' | 'progress';
  source: string;
  content: string;
  timestamp: Date;
  priority: number;
  metadata?: Record<string, unknown>;
}

export interface InterjectionBuffer {
  events: InterjectionEvent[];
  maxSize: number;
}

/**
 * Create an interjection buffer.
 */
export function createInterjectionBuffer(maxSize: number = 100): InterjectionBuffer {
  return { events: [], maxSize };
}

/**
 * Add an event to the buffer.
 */
export function addInterjection(
  buffer: InterjectionBuffer,
  event: Omit<InterjectionEvent, 'id' | 'timestamp'>,
): InterjectionEvent {
  const entry: InterjectionEvent = {
    ...event,
    id: crypto.randomUUID(),
    timestamp: new Date(),
  };

  buffer.events.push(entry);

  // Trim old events
  while (buffer.events.length > buffer.maxSize) {
    buffer.events.shift();
  }

  return entry;
}

/**
 * Get pending events sorted by priority.
 */
export function getPendingInterjections(buffer: InterjectionBuffer): InterjectionEvent[] {
  return [...buffer.events].sort((a, b) => b.priority - a.priority);
}

/**
 * Clear processed events.
 */
export function clearInterjections(buffer: InterjectionBuffer): void {
  buffer.events.length = 0;
}

/**
 * Format an interjection for display.
 */
export function formatInterjection(event: InterjectionEvent): string {
  const prefix = event.type === 'error' ? '!' :
                 event.type === 'status' ? '*' :
                 event.type === 'progress' ? '>' : '+';
  return `[${prefix}] ${event.source}: ${event.content}`;
}
