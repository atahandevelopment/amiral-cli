import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateRetryDelay,
  isRetryBudgetExhausted,
} from "../scripts/lib/providers/retry-policy.js";

const BASE = {
  attempt: 1,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  jitter: false,
};

describe("retry-policy", () => {
  it("doubles the delay exponentially per attempt", () => {
    assert.equal(calculateRetryDelay({ ...BASE, attempt: 1 }), 2000);
    assert.equal(calculateRetryDelay({ ...BASE, attempt: 2 }), 4000);
    assert.equal(calculateRetryDelay({ ...BASE, attempt: 3 }), 8000);
    assert.equal(calculateRetryDelay({ ...BASE, attempt: 4 }), 16000);
  });

  it("caps the delay at max_delay_ms", () => {
    assert.equal(
      calculateRetryDelay({ ...BASE, attempt: 10 }),
      30000,
    );
  });

  it("prefers a provider retry-after hint when reasonable", () => {
    // Within bounds: used directly.
    assert.equal(
      calculateRetryDelay({
        ...BASE,
        attempt: 1,
        retryAfterMs: 9000,
      }),
      9000,
    );

    // Below base delay: clamped up to base.
    assert.equal(
      calculateRetryDelay({
        ...BASE,
        attempt: 3,
        retryAfterMs: 100,
      }),
      2000,
    );

    // Above max delay: clamped down to max.
    assert.equal(
      calculateRetryDelay({
        ...BASE,
        attempt: 1,
        retryAfterMs: 600000,
      }),
      30000,
    );
  });

  it("applies bounded ±20% jitter with an injected random source", () => {
    const random = () => 0; // lowest jitter factor
    const randomMax = () => 0.999999; // highest jitter factor

    const low = calculateRetryDelay({
      ...BASE,
      attempt: 2,
      jitter: true,
      random,
    });

    const high = calculateRetryDelay({
      ...BASE,
      attempt: 2,
      jitter: true,
      random: randomMax,
    });

    // attempt=2 → 4000 ms exponential. Jitter factor ∈ [0.8, 1.2].
    assert.equal(low, Math.round(4000 * 0.8));
    assert.ok(high <= Math.round(4000 * 1.2));
    assert.ok(high > low);
  });

  it("never exceeds max_delay_ms even with jitter", () => {
    const delay = calculateRetryDelay({
      ...BASE,
      attempt: 8,
      jitter: true,
      random: () => 0.999999,
    });

    assert.equal(delay, 30000);
  });

  it("reports retry budget exhaustion", () => {
    assert.equal(isRetryBudgetExhausted(2, 3), false);
    assert.equal(isRetryBudgetExhausted(3, 3), true);
    assert.equal(isRetryBudgetExhausted(4, 3), true);
  });

  it("rejects invalid configuration", () => {
    assert.throws(
      () =>
        calculateRetryDelay({
          ...BASE,
          baseDelayMs: 0,
        }),
      /baseDelayMs/,
    );

    assert.throws(
      () =>
        calculateRetryDelay({
          ...BASE,
          maxDelayMs: 1000, // < baseDelayMs
        }),
      /maxDelayMs/,
    );
  });
});
