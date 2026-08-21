import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveQualityConfig,
  type TeamConfig,
} from "../scripts/lib/team-config.js";

/**
 * resolveQualityConfig is a pure function over the parsed team config;
 * no filesystem or cwd involvement, so a static import is safe here.
 */
describe("gates-config (resolveQualityConfig)", () => {
  it("defaults max_review_rounds to 3", () => {
    assert.deepEqual(resolveQualityConfig({}), { max_review_rounds: 3 });
    assert.deepEqual(
      resolveQualityConfig({ quality: {} }),
      { max_review_rounds: 3 },
    );
    assert.deepEqual(
      resolveQualityConfig({ quality: { max_review_rounds: undefined } }),
      { max_review_rounds: 3 },
    );
  });

  it("passes through a configured positive integer", () => {
    assert.deepEqual(
      resolveQualityConfig({ quality: { max_review_rounds: 1 } }),
      { max_review_rounds: 1 },
    );
    assert.deepEqual(
      resolveQualityConfig({ quality: { max_review_rounds: 5 } }),
      { max_review_rounds: 5 },
    );
  });

  it("rejects zero", () => {
    assert.throws(
      () => resolveQualityConfig({ quality: { max_review_rounds: 0 } }),
      /team\.yaml: quality\.max_review_rounds must be a positive integer\./,
    );
  });

  it("rejects non-numeric values", () => {
    assert.throws(
      () =>
        resolveQualityConfig({
          quality: { max_review_rounds: "x" as unknown as number },
        }),
      /team\.yaml: quality\.max_review_rounds must be a positive integer\./,
    );
  });

  it("rejects fractional values", () => {
    assert.throws(
      () => resolveQualityConfig({ quality: { max_review_rounds: 1.5 } }),
      /team\.yaml: quality\.max_review_rounds must be a positive integer\./,
    );
  });

  it("rejects negative values", () => {
    assert.throws(
      () => resolveQualityConfig({ quality: { max_review_rounds: -2 } }),
      /team\.yaml: quality\.max_review_rounds must be a positive integer\./,
    );
  });
});
