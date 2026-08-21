/**
 * Phase 13 — Provider registry / factory.
 *
 * Scheduler, dispatcher, planner, and quality gates obtain their execution
 * provider through this registry instead of importing OpenCode directly.
 * Adding a future provider (e.g. Codex) means implementing ExecutionProvider
 * and calling registerProvider — no orchestration changes required.
 */

import type {
  ExecutionProvider,
  PromptTransportProvider,
} from "./provider.js";
import { supportsPromptTransport } from "./provider.js";
import { OpenCodeProvider } from "./opencode-provider.js";

const registry = new Map<string, ExecutionProvider>();

export function registerProvider(provider: ExecutionProvider): void {
  if (!provider?.name) {
    throw new Error("A provider must expose a non-empty name.");
  }

  registry.set(provider.name, provider);
}

export function getExecutionProvider(name: string): ExecutionProvider {
  const provider = registry.get(name);

  if (!provider) {
    const known = [...registry.keys()].sort().join(", ") || "none";

    throw new Error(
      `Provider "${name}" is not registered. Registered providers: ${known}.`,
    );
  }

  return provider;
}

/**
 * Resolve a provider and require prompt-transport capability. Used by the
 * planner CLI and quality gates.
 */
export function getPromptTransport(
  name: string,
): ExecutionProvider & PromptTransportProvider {
  const provider = getExecutionProvider(name);

  if (!supportsPromptTransport(provider)) {
    throw new Error(
      `Provider "${name}" does not support prompt transport ` +
        `(required by planner and quality gates).`,
    );
  }

  return provider;
}

export function listProviders(): string[] {
  return [...registry.keys()].sort();
}

// Built-in providers. Only OpenCode is implemented in Phase 13; the
// abstraction keeps future providers isolated from orchestration logic.
registerProvider(new OpenCodeProvider());
