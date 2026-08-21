import type { ExecutionRequest } from "./execution-request.js";

/**
 * Phase 13 — Canonical Agent Result contract.
 *
 * This is a provider-neutral domain contract: every execution provider must
 * produce a value that validates against it before workflow state is updated.
 * Moved out of opencode-adapter.ts so the contract no longer lives inside a
 * provider-specific module. opencode-adapter.ts re-exports the type for
 * backward compatibility.
 */
export type AgentResult = {
  workflow_id: string;
  task_id: string;
  lease_id: string;
  agent: ExecutionRequest["agent"];
  status: "completed" | "failed" | "blocked";
  summary: string;
  files_changed?: string[];
  commands_executed?: string[];
  tests?: Array<
    | string
    | {
        name: string;
        result: "pass" | "fail" | "skipped";
        details?: string;
      }
  >;
  risks?: string[];
  additional_tasks_required?: string[];
  blocked_reason?: string;
  failure_reason?: string;
};
