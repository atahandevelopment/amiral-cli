/**
 * Phase 13 — OpenCode execution provider.
 *
 * All OpenCode-specific behavior lives here: binary resolution, prompt
 * building, process spawning, JSON event extraction, Agent Result recovery,
 * and failure classification. The rest of Amiral talks to this module only
 * through the ExecutionProvider / PromptTransportProvider interfaces.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import spawn from "cross-spawn";

import type { AgentResult } from "../agent-result.js";
import type { ExecutionRequest } from "../execution-request.js";
import {
  resolveProviderConfig,
  type TeamConfig,
} from "../team-config.js";
import { loadJson, writeJson } from "../workflow-store.js";
import { validateContract } from "../contract-validator.js";
import type {
  ExecutionProvider,
  ProviderCapacity,
  ProviderExecutionInput,
  ProviderExecutionOutput,
  PromptTransportInput,
  PromptTransportOutput,
} from "./provider.js";
import { ProviderError, classifyProviderFailure } from "./provider-error.js";
import { extractJsonObject, extractTextEvents } from "./output-extraction.js";

export { extractJsonObject, extractTextEvents };

type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type OpenCodeOptions = {
  binary: string;
  autoApprove: boolean;
  model?: string;
};

/**
 * Resolve OpenCode options from the normalized provider configuration with
 * legacy fallbacks (providers.opencode.* -> root opencode.* -> defaults).
 */
export function resolveOpenCodeOptions(
  config: TeamConfig,
  agent?: string,
): OpenCodeOptions {
  const providerConfig = resolveProviderConfig(config, "opencode");

  const model =
    agent && config.agents?.[agent as keyof typeof config.agents]?.model;

  return {
    binary: providerConfig.binary ?? "opencode",
    autoApprove: providerConfig.auto_approve === true,
    model:
      typeof model === "string" && model.trim() ? model.trim() : undefined,
  };
}

function buildPrompt(
  request: ExecutionRequest,
  localResultPath: string,
): string {
  return `
# OpenCode AI Team Execution Task

You are the assigned "${request.agent}" specialist.

## Workflow

Workflow ID: ${request.workflow_id}
Task ID: ${request.task_id}
Lease ID: ${request.lease_id}
Attempt: ${request.attempt}/${request.max_attempts}

## Task

### Title

${request.title}

### Description

${request.description}

### Acceptance Criteria

${request.acceptance_criteria.map((item) => `- ${item}`).join("\n")}

### Completed Dependencies

${
  request.context.dependencies.length
    ? request.context.dependencies.map((item) => `- ${item}`).join("\n")
    : "- none"
}

### Relevant Skills

${
  request.context.skills.length
    ? request.context.skills.map((item) => `- ${item}`).join("\n")
    : "- none"
}

## Execution Rules

1. Inspect the existing repository before making changes.
2. Follow your configured ${request.agent} agent instructions.
3. Follow existing project architecture and conventions.
4. Work only on this assigned task.
5. Do not orchestrate or delegate to other agents.
6. Load only relevant skills.
7. Run appropriate tests, build, lint, or type checking.
8. Do not modify workflow state files.
9. Do not silently expand the task scope.

## Mandatory Result

Before finishing:

1. Write the Agent Result JSON to the required result path.
2. Print the exact same JSON object as your final response.
3. Do not wrap the final JSON in explanatory prose.

${localResultPath}

The result must use this exact structure:

\`\`\`json
{
  "workflow_id": "${request.workflow_id}",
  "task_id": "${request.task_id}",
  "lease_id": "${request.lease_id}",
  "agent": "${request.agent}",
  "status": "completed",
  "summary": "Short summary of the work",
  "files_changed": [],
  "commands_executed": [],
 "tests": [
  {
    "name": "dotnet test",
    "result": "pass",
    "details": "17 tests passed"
  }
  ],
  "risks": [],
  "additional_tasks_required": []
}
\`\`\`

IMPORTANT:
- Every item in "tests" MUST be an object.
- "result" MUST be one of: "pass", "fail", "skipped".
- Do not put plain strings inside the "tests" array.

Allowed status values:

- completed
- failed
- blocked

For failed status include:

\`\`\`json
"failure_reason": "..."
\`\`\`

For blocked status include:

\`\`\`json
"blocked_reason": "..."
\`\`\`

Writing the result file is mandatory.

Do not finish with only a conversational response.
`.trim();
}

async function writeTaskPromptFile(
  request: ExecutionRequest,
  cwd: string,
  localResultPath: string,
): Promise<string> {
  const promptPath = resolve(
    cwd,
    ".amiral",
    "requests",
    `${request.task_id}.prompt.md`,
  );

  await mkdir(dirname(promptPath), {
    recursive: true,
  });

  await writeFile(promptPath, buildPrompt(request, localResultPath), "utf8");

  return promptPath;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);

      stdout += text;

      process.stdout.write(text);
    });

    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);

      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      // Spawn-level failure: missing binary etc. Classified by the caller
      // through classifySpawnError so it becomes a configuration error.
      reject(error);
    });

    child.on("close", (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Convert a spawn-level failure (ENOENT for a missing binary, permissions...)
 * into a structured non-retryable ProviderError.
 */
export function classifySpawnError(
  provider: string,
  error: unknown,
): ProviderError {
  const message =
    error instanceof Error ? error.message : String(error);

  return new ProviderError({
    message: `Could not start provider "${provider}": ${message}`,
    provider,
    kind: "configuration",
    retryable: false,
    raw: error,
  });
}

/**
 * Structured fallback result used when the provider finished without
 * producing the mandatory Agent Result and no JSON could be recovered from
 * its output. Exported for regression tests.
 */
export function createProtocolFailureResult(
  request: ExecutionRequest,
  stdout: string,
): AgentResult {
  const finalText = extractTextEvents(stdout);

  return {
    workflow_id: request.workflow_id,

    task_id: request.task_id,

    lease_id: request.lease_id,

    agent: request.agent,

    status: "failed",

    summary:
      "Agent execution finished without producing the mandatory structured Agent Result.",

    files_changed: [],

    commands_executed: [],

    tests: [],

    risks: [
      "The provider completed execution without satisfying the Amiral Agent Result protocol.",
    ],

    additional_tasks_required: [],

    failure_reason: finalText
      ? `Missing structured Agent Result. Final provider response: ${finalText.slice(
          0,
          1000,
        )}`
      : "Missing structured Agent Result and no usable final provider response was produced.",
  };
}

function normalizeAgentResult(result: AgentResult): AgentResult {
  if (!Array.isArray(result.tests)) {
    return result;
  }

  result.tests = result.tests.map((test) => {
    if (typeof test === "string") {
      return {
        name: test,
        result: "pass" as const,
      };
    }

    return test;
  });

  return result;
}

async function readAgentResult(
  request: ExecutionRequest,
  localResultPath: string,
  stdout: string,
): Promise<AgentResult> {
  try {
    return await loadJson<AgentResult>(localResultPath);
  } catch {
    const finalText = extractTextEvents(stdout);

    const recovered = extractJsonObject<AgentResult>(finalText);

    if (recovered) {
      await writeJson(localResultPath, recovered);

      return recovered;
    }

    const fallback = createProtocolFailureResult(request, stdout);

    await writeJson(localResultPath, fallback);

    return fallback;
  }
}

async function assertResultContract(
  request: ExecutionRequest,
  result: AgentResult,
): Promise<void> {
  if (result.workflow_id !== request.workflow_id) {
    throw new Error(
      `Result workflow_id mismatch: expected "${request.workflow_id}", got "${result.workflow_id}".`,
    );
  }

  if (result.task_id !== request.task_id) {
    throw new Error(
      `Result task_id mismatch: expected "${request.task_id}", got "${result.task_id}".`,
    );
  }

  if (result.lease_id !== request.lease_id) {
    throw new Error(
      `Stale result rejected for "${request.task_id}": lease mismatch.`,
    );
  }

  if (result.agent !== request.agent) {
    throw new Error(
      `Result agent mismatch: expected "${request.agent}", got "${result.agent}".`,
    );
  }
}

/**
 * OpenCode implementation of the provider-neutral execution interface.
 */
export class OpenCodeProvider implements ExecutionProvider {
  readonly name = "opencode";

  getCapacity(teamConfig: TeamConfig): ProviderCapacity {
    const providerConfig = resolveProviderConfig(teamConfig, this.name);

    return {
      provider: this.name,
      maxConcurrency: providerConfig.max_concurrency,
    };
  }

  async execute(
    input: ProviderExecutionInput,
  ): Promise<ProviderExecutionOutput> {
    const { request, teamConfig } = input;
    const cwd = input.cwd || process.cwd();

    await validateContract("execution-request", request);

    const localResultPath = resolve(
      cwd,
      ".amiral",
      "results",
      `${request.task_id}.json`,
    );

    await mkdir(dirname(localResultPath), {
      recursive: true,
    });

    const options = resolveOpenCodeOptions(teamConfig, request.agent);

    const promptFile = await writeTaskPromptFile(request, cwd, localResultPath);

    const args = [
      "run",
      "Execute the attached task specification completely. " +
        "Follow all instructions in the attached file. " +
        "Do not finish until the mandatory Agent Result JSON has been written.",
      "--agent",
      request.agent,
      "--dir",
      cwd,
      "--format",
      "json",
      "--file",
      promptFile,
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.autoApprove) {
      args.push("--auto");
    }

    let processResult: ProcessResult;

    try {
      processResult = await runProcess(options.binary, args, cwd);
    } catch (error) {
      throw classifySpawnError(this.name, error);
    }

    if (processResult.exitCode !== 0) {
      // Transient transport problems are surfaced as structured,
      // retryable ProviderErrors; task-level failures keep flowing
      // through the normal Agent Result path.
      throw classifyProviderFailure({
        provider: this.name,
        message:
          `OpenCode exited with code ${processResult.exitCode} for task "${request.task_id}".`,
        exitCode: processResult.exitCode,
        stderr: processResult.stderr,
        stdout: processResult.stdout,
      });
    }

    let result = await readAgentResult(
      request,
      localResultPath,
      processResult.stdout,
    );

    result = normalizeAgentResult(result);
    await validateContract("agent-result", result);

    await assertResultContract(request, result);

    const canonicalResultPath = resolve(
      process.cwd(),
      request.context.result_path,
    );

    await writeJson(canonicalResultPath, result);

    return {
      result,
      raw_stdout: processResult.stdout,
      raw_stderr: processResult.stderr,
      metadata: {
        binary: options.binary,
        exit_code: processResult.exitCode,
      },
    };
  }

  /**
   * Prompt transport for planner and quality gates. Never throws for
   * non-zero exits — callers classify the outcome themselves.
   */
  async runPrompt(input: PromptTransportInput): Promise<PromptTransportOutput> {
    const options = resolveOpenCodeOptions(
      input.teamConfig,
      input.agent,
    );

    const args = buildOpenCodePromptArgs(input, options.model, options.autoApprove);

    try {
      return await runProcess(options.binary, args, input.cwd);
    } catch (error) {
      throw classifySpawnError(this.name, error);
    }
  }
}

/** Build a CLI invocation with options before OpenCode's variadic message. */
export function buildOpenCodePromptArgs(
  input: PromptTransportInput,
  configuredModel?: string,
  configuredAutoApprove = false,
): string[] {
    const args = [
      "run",
      "--agent",
      input.agent,
      "--dir",
      input.cwd,
      "--format",
      "json",
    ];

    const model = input.model ?? configuredModel;

    if (model) {
      args.push("--model", model);
    }

    const autoApprove = input.autoApprove ?? configuredAutoApprove;

    if (autoApprove) {
      args.push("--auto");
    }

    args.push(input.prompt);
    return args;
}
