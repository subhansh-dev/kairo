/**
 * Analytics — event tracking (stub, Mixpanel-compatible).
 */

export interface AnalyticsEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: Date;
  distinctId?: string;
}

export interface AnalyticsConfig {
  enabled: boolean;
  writeKey?: string;
  flushIntervalMs: number;
  maxQueueSize: number;
}

const DEFAULT_ANALYTICS_CONFIG: AnalyticsConfig = {
  enabled: false,
  flushIntervalMs: 30_000,
  maxQueueSize: 100,
};

/**
 * Create an analytics client.
 */
export function createAnalytics(config?: Partial<AnalyticsConfig>): {
  track(event: string, properties?: Record<string, unknown>): void;
  flush(): Promise<void>;
  queue(): AnalyticsEvent[];
  clear(): void;
} {
  const cfg = { ...DEFAULT_ANALYTICS_CONFIG, ...config };
  const queue: AnalyticsEvent[] = [];

  return {
    track(event, properties = {}) {
      if (!cfg.enabled) return;

      queue.push({
        event,
        properties,
        timestamp: new Date(),
      });

      // Trim queue
      while (queue.length > cfg.maxQueueSize) queue.shift();
    },

    async flush() {
      if (queue.length === 0) return;

      // Stub: in production, send to analytics endpoint
      queue.length = 0;
    },

    queue() {
      return [...queue];
    },

    clear() {
      queue.length = 0;
    },
  };
}
