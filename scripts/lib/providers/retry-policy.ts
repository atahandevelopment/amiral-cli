/**
 * Phase 13 — Retry policy for transient provider failures.
 *
 * Pure helpers only: no timers, no I/O. The dispatcher computes a delay and
 * persists `retry_not_before` in workflow state; the scheduler later reclaims
 * the task once the timestamp has passed. This keeps retries resilient across
 * process restarts (no in-memory setTimeout is required for correctness).
 */

export type RetryDelayInput = {
  /**
   * 1-based number of the attempt that just failed.
   * attempt=1 → base delay, attempt=2 → 2×base, attempt=3 → 4×base ...
   */
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /**
   * Provider-provided retry hint in milliseconds. Preferred over exponential
   * backoff when it is positive; the result is still clamped to
   * [baseDelayMs, maxDelayMs] so a broken provider hint cannot disable or
   * extend our own budget.
   */
  retryAfterMs?: number;
  /** Apply ±20% jitter to avoid thundering-herd retries. */
  jitter: boolean;
  /**
   * Injected random source in [0,1) for deterministic tests.
   * Defaults to Math.random.
   */
  random?: () => number;
};

export const JITTER_FRACTION = 0.2;

/**
 * Exponential backoff with optional jitter:
 *
 *   delay(attempt) = min(baseDelayMs * 2^(attempt-1), maxDelayMs)
 *
 * If `retryAfterMs` is available and positive it is preferred ("provider
 * retry-after when reasonable"), clamped into [baseDelayMs, maxDelayMs].
 *
 * Jitter multiplies the final delay by a factor in [1-f, 1+f] where
 * f = JITTER_FRACTION, then clamps to maxDelayMs again.
 */
export function calculateRetryDelay(input: RetryDelayInput): number {
  const {
    attempt,
    baseDelayMs,
    maxDelayMs,
    retryAfterMs,
    jitter,
    random = Math.random,
  } = input;

  if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) {
    throw new Error("baseDelayMs must be a positive number.");
  }

  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new Error("maxDelayMs must be >= baseDelayMs.");
  }

  const safeAttempt = Number.isInteger(attempt) && attempt >= 1 ? attempt : 1;

  let delayMs: number;

  if (
    typeof retryAfterMs === "number" &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
  ) {
    // Provider hint wins, but stays inside our own configured bounds.
    delayMs = Math.min(Math.max(retryAfterMs, baseDelayMs), maxDelayMs);
  } else {
    const exponential = baseDelayMs * Math.pow(2, safeAttempt - 1);
    delayMs = Math.min(exponential, maxDelayMs);
  }

  if (jitter) {
    const factor =
      1 - JITTER_FRACTION + random() * 2 * JITTER_FRACTION;

    delayMs = Math.min(delayMs * factor, maxDelayMs);
  }

  return Math.max(1, Math.round(delayMs));
}

/**
 * Whether the retry budget is exhausted after the given number of consumed
 * attempts. Task attempts are counted by the scheduler on every claim, so
 * this uses the same numbers as the existing lease-expiry logic.
 */
export function isRetryBudgetExhausted(
  attempts: number,
  maxAttempts: number,
): boolean {
  return attempts >= maxAttempts;
}
