/**
 * Phase 13 — Backward-compatibility shim.
 *
 * The OpenCode execution implementation moved to
 * scripts/lib/providers/opencode-provider.ts and is reached through the
 * provider registry. This module keeps the historical import surface stable
 * for existing call sites and external users:
 *
 *   - AgentResult type            (now defined in lib/agent-result.ts)
 *   - extractTextEvents           (now in providers/output-extraction.ts)
 *   - extractJsonObject           (now in providers/output-extraction.ts)
 *   - executeWithOpenCode()       (delegates to the registered provider)
 */

import type { AgentResult } from "./agent-result.js";
import type { ExecutionRequest } from "./execution-request.js";
import type { TeamConfig } from "./team-config.js";
import { getExecutionProvider } from "./providers/provider-registry.js";

export type { AgentResult } from "./agent-result.js";
export {
  extractJsonObject,
  extractTextEvents,
} from "./providers/output-extraction.js";

export type OpenCodeExecutionContext = {
  cwd?: string;
};

/**
 * Legacy entry point preserved for backward compatibility.
 *
 * New code should obtain the provider through the registry:
 *
 *   const provider = getExecutionProvider("opencode");
 *   const output = await provider.execute({ request, cwd, teamConfig });
 */
export async function executeWithOpenCode(
  request: ExecutionRequest,
  teamConfig: TeamConfig,
  context: OpenCodeExecutionContext = {},
): Promise<AgentResult> {
  const provider = getExecutionProvider("opencode");

  const output = await provider.execute({
    request,
    teamConfig,
    cwd: context.cwd ?? process.cwd(),
  });

  if (!output.result) {
    throw new Error(
      `Provider "opencode" returned no Agent Result for task "${request.task_id}".`,
    );
  }

  return output.result;
}
