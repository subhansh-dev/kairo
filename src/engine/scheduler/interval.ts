/**
 * Scheduler interval parsing and human-readable formatting.
 *
 */

const MINIMUM_INTERVAL_SECS = 60;

/**
 * Parse an interval string like "5m", "2h", "30s", "1d" into seconds.
 * Minimum interval is 60 seconds; values below are clamped.
 */
export function parseInterval(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) {
    throw new Error('interval cannot be empty');
  }

  const digits = trimmed.slice(0, -1);
  const suffix = trimmed.slice(-1);
  const value = parseInt(digits, 10);

  if (isNaN(value)) {
    throw new Error(
      `invalid interval format: ${JSON.stringify(trimmed)} (expected e.g. 5m, 2h, 1d)`
    );
  }

  if (value === 0) {
    throw new Error('interval value must be greater than 0');
  }

  let unitSecs: number;
  switch (suffix) {
    case 's': unitSecs = 1; break;
    case 'm': unitSecs = 60; break;
    case 'h': unitSecs = 3600; break;
    case 'd': unitSecs = 86400; break;
    default:
      throw new Error(
        `invalid interval suffix: ${JSON.stringify(suffix)} (expected s, m, h, or d)`
      );
  }

  const secs = value * unitSecs;
  if (!isFinite(secs)) {
    throw new Error(`interval too large: ${JSON.stringify(trimmed)}`);
  }

  return Math.max(secs, MINIMUM_INTERVAL_SECS);
}

/**
 * Convert seconds to a human-readable interval string.
 * e.g. 300 -> "every 5 minutes", 3600 -> "every 1 hour"
 */
export function intervalToHuman(secs: number): string {
  if (secs % 86400 === 0) {
    const n = secs / 86400;
    return n === 1 ? 'every 1 day' : `every ${n} days`;
  } else if (secs % 3600 === 0) {
    const n = secs / 3600;
    return n === 1 ? 'every 1 hour' : `every ${n} hours`;
  } else if (secs % 60 === 0) {
    const n = secs / 60;
    return n === 1 ? 'every 1 minute' : `every ${n} minutes`;
  } else if (secs === 1) {
    return 'every 1 second';
  } else {
    return `every ${secs} seconds`;
  }
}
