/**
 * Phase 13 — Provider-neutral execution interface.
 *
 * Amiral's scheduler, dispatcher, planner, and quality gates depend only on
 * these types — never on OpenCode-specific details. OpenCode is one
 * implementation registered in the provider registry.
 */

import type { AgentResult } from "../agent-result.js";
import type { ExecutionRequest } from "../execution-request.js";
import type { TeamConfig } from "../team-config.js";

export type ProviderName = string;

export type ProviderExecutionInput = {
  request: ExecutionRequest;
  cwd: string;
  teamConfig: TeamConfig;
};

export type ProviderExecutionOutput = {
  /**
   * Validated Agent Result. Providers should always produce a result for a
   * finished run (including structured protocol-failure results); it is
   * optional only so that a provider MAY throw a ProviderError instead.
   */
  result?: AgentResult;

  raw_stdout?: string;
  raw_stderr?: string;

  metadata?: Record<string, unknown>;
};

export type ProviderCapacity = {
  provider: ProviderName;
  maxConcurrency: number;
};

export interface ExecutionProvider {
  name: ProviderName;

  /**
   * Execute one claimed task attempt. Transient transport problems must be
   * thrown as ProviderError with retryable=true; task-level outcomes
   * (failed/blocked/completed) are returned as AgentResult values.
   */
  execute(input: ProviderExecutionInput): Promise<ProviderExecutionOutput>;

  getCapacity(teamConfig: TeamConfig): ProviderCapacity;
}

/**
 * Prompt transport capability.
 *
 * Planner and quality gates do not use the ExecutionRequest contract; they
 * need to transport a raw prompt to an agent and get raw output back. The
 * domain layer keeps extracting/validating its own result contract
 * (TaskGraphPlan / QualityGateResult) from that output.
 *
 * Implementations must NOT throw for non-zero exit codes; they return the
 * outcome and let callers classify it via classifyProviderFailure. Only
 * spawn-level failures (e.g. missing binary) throw a ProviderError.
 */
export type PromptTransportInput = {
  agent: string;
  prompt: string;
  cwd: string;
  teamConfig: TeamConfig;
  /** Overrides team config when provided. */
  model?: string;
  autoApprove?: boolean;
};

export type PromptTransportOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export interface PromptTransportProvider {
  runPrompt(input: PromptTransportInput): Promise<PromptTransportOutput>;
}

/**
 * Type guard helper: does this provider support prompt transport?
 */
export function supportsPromptTransport(
  provider: ExecutionProvider,
): provider is ExecutionProvider & PromptTransportProvider {
  return (
    typeof (provider as unknown as PromptTransportProvider).runPrompt ===
    "function"
  );
}
