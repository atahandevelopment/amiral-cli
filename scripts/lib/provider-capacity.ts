import type { TeamConfig } from "./team-config.js";
import { getExecutionProvider } from "./providers/provider-registry.js";
import type { ProviderCapacity } from "./providers/provider.js";

export type { ProviderCapacity } from "./providers/provider.js";

/**
 * Phase 13 — Capacity resolution now delegates to the provider registry so
 * capacity logic lives in exactly one place (the provider implementation).
 *
 * Kept as a thin wrapper because existing call sites (run-workflow.ts and
 * tests) use this function signature.
 */
export function getProviderCapacity(
  config: TeamConfig,
  provider: string,
): ProviderCapacity {
  return getExecutionProvider(provider).getCapacity(config);
}
