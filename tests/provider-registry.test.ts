import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getExecutionProvider,
  getPromptTransport,
  listProviders,
  registerProvider,
} from "../scripts/lib/providers/provider-registry.js";
import type {
  ExecutionProvider,
  ProviderExecutionInput,
} from "../scripts/lib/providers/provider.js";
import { getProviderCapacity } from "../scripts/lib/provider-capacity.js";
import { loadTeamConfig } from "../scripts/lib/team-config.js";

describe("provider-registry", () => {
  it("resolves the built-in opencode provider", () => {
    const provider = getExecutionProvider("opencode");

    assert.equal(provider.name, "opencode");
    assert.equal(typeof provider.execute, "function");
    assert.equal(typeof provider.getCapacity, "function");
  });

  it("fails clearly for unknown providers", () => {
    assert.throws(
      () => getExecutionProvider("codex"),
      /Provider "codex" is not registered/,
    );
  });

  it("lists registered providers", () => {
    assert.ok(listProviders().includes("opencode"));
  });

  it("exposes prompt transport for the planner and quality gates", () => {
    const transport = getPromptTransport("opencode");

    assert.equal(typeof transport.runPrompt, "function");
  });

  it("rejects prompt-transport requests for providers without the capability", () => {
    const fake: ExecutionProvider = {
      name: "fake-no-transport",
      async execute(_input: ProviderExecutionInput) {
        return {};
      },
      getCapacity() {
        return { provider: "fake-no-transport", maxConcurrency: 1 };
      },
    };

    registerProvider(fake);

    assert.throws(
      () => getPromptTransport("fake-no-transport"),
      /does not support prompt transport/,
    );
  });

  it("delegates capacity resolution to the provider implementation", async () => {
    const teamConfig = await loadTeamConfig();

    const capacity = getProviderCapacity(teamConfig, "opencode");

    assert.equal(capacity.provider, "opencode");
    // Repo team.yaml configures max_concurrency: 1.
    assert.equal(capacity.maxConcurrency, 1);
  });
});
