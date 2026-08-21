import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KIND_RETRYABILITY,
  ProviderError,
  classifyProviderFailure,
  classifyStatusCode,
} from "../scripts/lib/providers/provider-error.js";

describe("provider-error", () => {
  it("classifies HTTP 429 as retryable rate_limit", () => {
    const error = classifyProviderFailure({
      provider: "opencode",
      message: "request failed",
      exitCode: 1,
      stderr: "Error: API request failed with status 429",
    });

    assert.equal(error.kind, "rate_limit");
    assert.equal(error.retryable, true);
    assert.equal(error.statusCode, 429);
    assert.ok(error instanceof ProviderError);
  });

  it("classifies HTTP 503 as retryable unavailable", () => {
    const error = classifyProviderFailure({
      provider: "opencode",
      message: "request failed",
      exitCode: 1,
      stderr: "service unavailable (503)",
    });

    assert.equal(error.kind, "unavailable");
    assert.equal(error.retryable, true);
    assert.equal(error.statusCode, 503);
  });

  it("classifies timeouts as retryable", () => {
    const error = classifyProviderFailure({
      provider: "opencode",
      message: "request failed",
      exitCode: 1,
      stderr: "Request timed out after 30000 ms",
    });

    assert.equal(error.kind, "timeout");
    assert.equal(error.retryable, true);
  });

  it("classifies connection resets and DNS failures as retryable network errors", () => {
    const reset = classifyProviderFailure({
      provider: "opencode",
      message: "request failed",
      exitCode: 1,
      stderr: "socket hang up (ECONNRESET)",
    });

    const dns = classifyProviderFailure({
      provider: "opencode",
      message: "request failed",
      exitCode: 1,
      stderr: "getaddrinfo EAI_AGAIN api.example.com",
    });

    assert.equal(reset.kind, "network");
    assert.equal(reset.retryable, true);
    assert.equal(dns.kind, "network");
    assert.equal(dns.retryable, true);
  });

  it("classifies database locks as retryable capacity errors", () => {
    const error = classifyProviderFailure({
      provider: "opencode",
      message: "request failed",
      exitCode: 1,
      stderr: "SQLite: database is locked",
    });

    assert.equal(error.kind, "capacity");
    assert.equal(error.retryable, true);
  });

  it("classifies authentication failures as non-retryable", () => {
    const unauthorized = classifyProviderFailure({
      provider: "opencode",
      message: "request failed",
      exitCode: 1,
      stderr: "401 Unauthorized: invalid api key",
    });

    assert.equal(unauthorized.kind, "authentication");
    assert.equal(unauthorized.retryable, false);
  });

  it("classifies configuration problems as non-retryable", () => {
    const unsupportedModel = classifyProviderFailure({
      provider: "opencode",
      message: "request failed",
      exitCode: 1,
      stderr: "unsupported model: gpt-99-turbo",
    });

    const missingBinary = classifyProviderFailure({
      provider: "opencode",
      message: "spawn opencode ENOENT",
    });

    assert.equal(unsupportedModel.kind, "configuration");
    assert.equal(unsupportedModel.retryable, false);
    assert.equal(missingBinary.kind, "configuration");
    assert.equal(missingBinary.retryable, false);
  });

  it("treats unrecognized output as non-retryable unknown", () => {
    const error = classifyProviderFailure({
      provider: "opencode",
      message: "OpenCode exited with code 1",
      exitCode: 1,
      stderr: "something completely unexpected happened",
    });

    assert.equal(error.kind, "unknown");
    assert.equal(error.retryable, false);
  });

  it("prefers structured status codes over text matching", () => {
    // Text says 429 but structured status says 503.
    const error = classifyProviderFailure({
      provider: "opencode",
      message: "conflicting signals",
      statusCode: 503,
      stderr: "rate limit exceeded 429",
    });

    assert.equal(error.kind, "unavailable");
    assert.equal(error.statusCode, 503);
  });

  it("extracts Retry-After hints as retryAfterMs", () => {
    const error = classifyProviderFailure({
      provider: "opencode",
      message: "slow down",
      exitCode: 1,
      stderr: "error: quota cooldown, retry-after 12 s",
    });

    assert.equal(error.kind, "rate_limit");
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 12000);
  });

  it("maps status codes through classifyStatusCode", () => {
    assert.equal(classifyStatusCode(429), "rate_limit");
    assert.equal(classifyStatusCode(401), "authentication");
    assert.equal(classifyStatusCode(403), "authentication");
    assert.equal(classifyStatusCode(503), "unavailable");
    assert.equal(classifyStatusCode(500), "unavailable");
    assert.equal(classifyStatusCode(404), "configuration");
    assert.equal(classifyStatusCode(422), "protocol");
  });

  it("keeps protocol failures non-retryable by policy", () => {
    assert.equal(KIND_RETRYABILITY.protocol, false);
  });
});
