/**
 * Kairo — Observability System
 * Tracks agent activity, detects silent failures, provides diagnostics.
 * 
 */

export interface ActivityEvent {
  timestamp: number;
  type: 'tool_call' | 'model_call' | 'error' | 'route' | 'compact' | 'checkpoint' | 'thinking';
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface SilentFailure {
  type: 'repeated_output' | 'no_progress' | 'stuck_loop' | 'context_drift' | 'goal_drift';
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

interface ActivityWindow {
  events: ActivityEvent[];
  startTime: number;
  toolCalls: Map<string, number>;
  errors: Array<{ tool: string; error: string; timestamp: number }>;
  outputHashes: string[]; // last N output hashes for duplicate detection
}

const window: ActivityWindow = {
  events: [],
  startTime: Date.now(),
  toolCalls: new Map(),
  errors: [],
  outputHashes: [],
};

const MAX_EVENTS = 500;
const MAX_OUTPUT_HASHES = 20;

/**
 * Record an activity event.
 */
export function recordActivity(event: Omit<ActivityEvent, 'timestamp'>): void {
  const fullEvent: ActivityEvent = { ...event, timestamp: Date.now() };
  window.events.push(fullEvent);

  // Trim old events
  if (window.events.length > MAX_EVENTS) {
    window.events = window.events.slice(-MAX_EVENTS);
  }

  // Track tool calls
  if (event.type === 'tool_call') {
    const count = window.toolCalls.get(event.detail) || 0;
    window.toolCalls.set(event.detail, count + 1);
  }

  // Track errors
  if (event.type === 'error') {
    window.errors.push({
      tool: event.metadata?.tool as string || 'unknown',
      error: event.detail,
      timestamp: Date.now(),
    });
    if (window.errors.length > 50) window.errors.shift();
  }
}

/**
 * Record output hash for duplicate detection.
 */
export function recordOutputHash(hash: string): void {
  window.outputHashes.push(hash);
  if (window.outputHashes.length > MAX_OUTPUT_HASHES) {
    window.outputHashes.shift();
  }
}

/**
 * Detect silent failures — patterns where the agent seems stuck or unproductive.
 */
export function detectSilentFailures(): SilentFailure[] {
  const failures: SilentFailure[] = [];
  const now = Date.now();
  const recentWindow = 5 * 60 * 1000; // 5 minutes

  // 1. Repeated output detection
  if (window.outputHashes.length >= 3) {
    const last3 = window.outputHashes.slice(-3);
    if (last3[0] === last3[1] && last3[1] === last3[2]) {
      failures.push({
        type: 'repeated_output',
        description: 'Agent produced identical output 3+ times in a row',
        severity: 'high',
        suggestion: 'The agent may be stuck. Try rephrasing the task or providing more context.',
      });
    }
  }

  // 2. No progress detection — many tool calls but no new output
  const recentEvents = window.events.filter(e => e.timestamp > now - recentWindow);
  const recentToolCalls = recentEvents.filter(e => e.type === 'tool_call');
  const recentModelCalls = recentEvents.filter(e => e.type === 'model_call');
  if (recentToolCalls.length > 10 && recentModelCalls.length < 2) {
    failures.push({
      type: 'no_progress',
      description: `${recentToolCalls.length} tool calls but only ${recentModelCalls.length} model responses in last 5 min`,
      severity: 'medium',
      suggestion: 'Agent may be running tools without reasoning about results.',
    });
  }

  // 3. Stuck loop — same tool called many times
  for (const [tool, count] of window.toolCalls) {
    if (count > 15) {
      failures.push({
        type: 'stuck_loop',
        description: `Tool "${tool}" called ${count} times total`,
        severity: count > 30 ? 'high' : 'medium',
        suggestion: `Consider if repeated ${tool} calls are necessary. The agent may be retrying failed operations.`,
      });
    }
  }

  // 4. Error spike
  const recentErrors = window.errors.filter(e => e.timestamp > now - recentWindow);
  if (recentErrors.length > 5) {
    failures.push({
      type: 'context_drift',
      description: `${recentErrors.length} errors in the last 5 minutes`,
      severity: 'high',
      suggestion: 'Multiple errors suggest the agent may be working with incorrect assumptions.',
    });
  }

  // 5. Context drift — long session without compaction
  const sessionDuration = now - window.startTime;
  if (sessionDuration > 30 * 60 * 1000 && recentEvents.length > 100) {
    const compactEvents = recentEvents.filter(e => e.type === 'compact');
    if (compactEvents.length === 0) {
      failures.push({
        type: 'context_drift',
        description: 'Long session without context compaction',
        severity: 'low',
        suggestion: 'Consider running /compact to reduce context size and improve focus.',
      });
    }
  }

  return failures;
}

/**
 * Get activity summary for status display.
 */
export function getActivitySummary(): string {
  const now = Date.now();
  const recentWindow = 5 * 60 * 1000;
  const recentEvents = window.events.filter(e => e.timestamp > now - recentWindow);

  const toolCounts = new Map<string, number>();
  let errors = 0;
  for (const e of recentEvents) {
    if (e.type === 'tool_call') {
      toolCounts.set(e.detail, (toolCounts.get(e.detail) || 0) + 1);
    }
    if (e.type === 'error') errors++;
  }

  const parts: string[] = [];
  if (toolCounts.size > 0) {
    const tools = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, c]) => `${t}(${c})`)
      .join(', ');
    parts.push(`Tools: ${tools}`);
  }
  if (errors > 0) parts.push(`Errors: ${errors}`);
  parts.push(`Events: ${recentEvents.length}`);

  return parts.join(' | ');
}

/**
 * Get full diagnostic report.
 */
export function getDiagnostics(): string {
  const failures = detectSilentFailures();
  const summary = getActivitySummary();

  const lines = [`Activity: ${summary}`];
  if (failures.length > 0) {
    lines.push('\nPotential issues:');
    for (const f of failures) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.type}: ${f.description}`);
      lines.push(`    → ${f.suggestion}`);
    }
  } else {
    lines.push('\nNo issues detected.');
  }

  return lines.join('\n');
}

/**
 * Reset observability state.
 */
export function resetObservability(): void {
  window.events = [];
  window.startTime = Date.now();
  window.toolCalls.clear();
  window.errors = [];
  window.outputHashes = [];
}
