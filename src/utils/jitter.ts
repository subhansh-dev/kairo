/**
 * Kairo — Jittered Backoff
 * Decorrelated jitter for retry delays to prevent thundering-herd spikes
 * when multiple sessions hit the same rate-limited provider concurrently.
 *
 * Replaces fixed exponential backoff with jittered delays.
 */

// Monotonic counter for jitter seed uniqueness within the same process.
let jitterCounter = 0;

/**
 * Compute a jittered exponential backoff delay.
 *
 * @param attempt - 1-based retry attempt number
 * @param baseDelay - Base delay in seconds for attempt 1
 * @param maxDelay - Maximum delay cap in seconds
 * @param jitterRatio - Fraction of computed delay to use as random jitter range
 * @returns Delay in milliseconds: min(base * 2^(attempt-1), maxDelay) + jitter
 */
export function jitteredBackoff(
  attempt: number,
  baseDelay: number = 5.0,
  maxDelay: number = 120.0,
  jitterRatio: number = 0.5,
): number {
  jitterCounter++;
  const tick = jitterCounter;

  const exponent = Math.max(0, attempt - 1);
  let delay: number;

  if (exponent >= 63 || baseDelay <= 0) {
    delay = maxDelay;
  } else {
    delay = Math.min(baseDelay * Math.pow(2, exponent), maxDelay);
  }

  // Seed from time + counter for decorrelation even with coarse clocks
  const seed = (Date.now() ^ (tick * 0x9E3779B9)) >>> 0;
  const rng = mulberry32(seed);
  const jitter = rng() * jitterRatio * delay;

  return (delay + jitter) * 1000; // Convert to milliseconds
}

/**
 * Simple seeded PRNG (Mulberry32) for deterministic jitter.
 * Avoids Math.random() so the same seed always produces the same sequence.
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
