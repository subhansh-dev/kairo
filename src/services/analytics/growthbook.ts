/**
 * Kairo — GrowthBook Analytics (Stub)
 * Kairo doesn't use feature flags — all calls return defaults
 */

export function getFeatureValue_CACHED_MAY_BE_STALE(_key: string, defaultValue: unknown): unknown {
  return defaultValue
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(_gate: string): boolean {
  return false
}
