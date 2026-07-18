/**
 * Tracing — distributed tracing primitives.
 */

export interface Span {
  id: string;
  parentId?: string;
  name: string;
  startTime: Date;
  endTime?: Date;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: Date;
  attributes?: Record<string, string | number | boolean>;
}

export interface Trace {
  traceId: string;
  spans: Span[];
}

/**
 * Create a new span.
 */
export function createSpan(
  name: string,
  parentId?: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  return {
    id: crypto.randomUUID(),
    parentId,
    name,
    startTime: new Date(),
    attributes: attributes ?? {},
    events: [],
  };
}

/**
 * Finish a span.
 */
export function finishSpan(span: Span): void {
  span.endTime = new Date();
}

/**
 * Add an event to a span.
 */
export function addSpanEvent(span: Span, name: string, attributes?: Record<string, string | number | boolean>): void {
  span.events.push({
    name,
    timestamp: new Date(),
    attributes,
  });
}

/**
 * Get the duration of a span in milliseconds.
 */
export function spanDurationMs(span: Span): number {
  const end = span.endTime ?? new Date();
  return end.getTime() - span.startTime.getTime();
}

/**
 * Create a trace.
 */
export function createTrace(): Trace {
  return {
    traceId: crypto.randomUUID(),
    spans: [],
  };
}

/**
 * Add a span to a trace.
 */
export function addSpanToTrace(trace: Trace, span: Span): void {
  trace.spans.push(span);
}

/**
 * Find the root span of a trace.
 */
export function findRootSpan(trace: Trace): Span | undefined {
  return trace.spans.find(s => !s.parentId);
}

/**
 * Find child spans of a given span.
 */
export function findChildSpans(trace: Trace, parentId: string): Span[] {
  return trace.spans.filter(s => s.parentId === parentId);
}
