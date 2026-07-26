/**
 * Kairo — Analytics (Stub)
 * Kairo doesn't use analytics — all calls are no-ops
 */

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = Record<string, unknown>

export function logEvent(_name: string, _data?: unknown): void {
  // no-op in kairo
}

export function logEventWithStatsig(_name: string, _data?: unknown): void {
  // no-op in kairo
}
