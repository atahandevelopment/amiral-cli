#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentResult } from "./lib/agent-result.js";
import type { ExecutionRequest } from "./lib/execution-request.js";
import type { WorkflowState } from "./lib/types.js";
import {
  loadTeamConfig,
  resolveDefaultProviderName,
  resolveExecutionConfig,
  resolveProviderConfig,
} from "./lib/team-config.js";
import { getExecutionProvider } from "./lib/providers/provider-registry.js";
import { ProviderError } from "./lib/providers/provider-error.js";
import {
  applyPermanentProviderFailure,
  applyProviderRetry,
  maybeRecordProviderRecovery,
} from "./lib/provider-retry.js";
import { finalizeTaskWorktree } from "./lib/task-finalizer.js";

import {
  appendHistory,
  deriveWorkflowStatus,
  loadJson,
  loadState,
  saveState,
  workflowDir,
} from "./lib/workflow-store.js";
import {
  assertCleanWorkingTree,
  createTaskWorktree,
  getWorktreeDiff,
} from "./lib/git-worktree.js";

type DispatchResultStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "retry_wait"
  | "error";

type DispatchResult = {
  taskId: string;
  agent: string;
  status: DispatchResultStatus;
  summary: string;
  branch?: string;
  worktree?: string;
  commit?: string;
  /** Structured provider diagnostics for retry_wait / failed outcomes. */
  diagnostics?: string[];
};

type CliOptions = {
  workflowId?: string;
};

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  let workflowId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--workflow":
      case "-w":
        workflowId = args[index + 1];
        if (!workflowId) {
          fail(`${arg} requires a workflow id.`);
        }
        index += 1;
        break;

      default:
        fail(`Unknown argument: "${arg}".`);
    }
  }

  return { workflowId };
}

async function listRequestFiles(
  workflowId: string,
  requestsDirectory: string,
): Promise<string[]> {
  const directory = resolve(workflowDir(workflowId), requestsDirectory);

  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => resolve(directory, entry.name));
  } catch {
    return [];
  }
}

function isDispatchableRequest(
  request: ExecutionRequest,
  state: WorkflowState,
): boolean {
  const task = state.tasks.find((item) => item.id === request.task_id);

  return Boolean(
    task &&
    task.status === "in_progress" &&
    task.lease_id &&
    task.lease_id === request.lease_id,
  );
}

async function applyResult(
  request: ExecutionRequest,
  result: AgentResult,
): Promise<void> {
  const state = await loadState(request.workflow_id);
  const task = state.tasks.find((item) => item.id === request.task_id);

  if (!task) {
    throw new Error(`Task "${request.task_id}" does not exist.`);
  }

  if (task.status !== "in_progress") {
    throw new Error(
      `Task "${task.id}" is "${task.status}", expected "in_progress".`,
    );
  }

  if (task.lease_id !== request.lease_id) {
    throw new Error(
      `Cannot apply stale result for "${task.id}": lease mismatch.`,
    );
  }

  const timestamp = new Date().toISOString();
  const previousWorkflowStatus = state.status;

  task.result_file = request.context.result_path;
  task.lease_id = null;
  task.lease_expires_at = null;

  switch (result.status) {
    case "completed":
      task.status = "completed";
      task.completed_at = timestamp;
      task.last_error = null;
      break;

    case "failed":
      task.status = "failed";
      task.completed_at = null;
      task.last_error = result.failure_reason ?? result.summary;
      break;

    case "blocked":
      task.status = "blocked";
      task.completed_at = null;
      task.last_error = result.blocked_reason ?? result.summary;
      break;
  }

  if (result.status === "completed") {
    await maybeRecordProviderRecovery(state, task);
  }

  state.status = deriveWorkflowStatus(state);
  await saveState(state);

  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "task_result_attached",
    task_id: task.id,
    message: `Dispatcher applied validated result: ${result.status}.`,
  });

  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "task_status_changed",
    task_id: task.id,
    message: `in_progress -> ${task.status} (isolated worktree)`,
  });

  if (previousWorkflowStatus !== state.status) {
    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "workflow_status_changed",
      message: `${previousWorkflowStatus} -> ${state.status}`,
    });
  }
}

async function executeRequest(
  request: ExecutionRequest,
  providerName: string,
): Promise<DispatchResult> {
  const teamConfig = await loadTeamConfig();

  const provider = getExecutionProvider(providerName);

  const baseRef = request.task_id.startsWith("FIX-")
    ? `amiral/${request.workflow_id}/integration`
    : "HEAD";

  let worktreePath: string | undefined;
  let branchName: string | undefined;

  try {
    const worktree = await createTaskWorktree(
      request.workflow_id,
      request.task_id,
      baseRef,
    );

    worktreePath = worktree.worktreePath;
    branchName = worktree.branchName;

    console.log(`[${request.task_id}] worktree: ${worktree.worktreePath}`);

    const output = await provider.execute({
      request,
      teamConfig,
      cwd: worktree.worktreePath,
    });

    const result = output.result!;

    let commit: string | undefined;

    if (result.status === "completed") {
      const finalized = await finalizeTaskWorktree(
        worktree.worktreePath,
        request.workflow_id,
        request.task_id,
        request.title,
      );

      commit = finalized.commit;
    }

    const diff = await getWorktreeDiff(worktree.worktreePath);

    await applyResult(request, result);

    return {
      taskId: request.task_id,
      agent: request.agent,
      status: result.status,
      summary: diff
        ? `${result.summary} | Changes detected in isolated worktree.`
        : result.summary,
      branch: worktree.branchName,
      worktree: worktree.worktreePath,
      commit,
    };
  } catch (error) {
    if (error instanceof ProviderError) {
      return await handleProviderFailure({
        request,
        error,
        teamConfig,
        providerName,
        worktreePath,
        branchName,
      });
    }

    return {
      taskId: request.task_id,
      agent: request.agent,
      status: "error",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

type ProviderFailureContext = {
  request: ExecutionRequest;
  error: ProviderError;
  teamConfig: Awaited<ReturnType<typeof loadTeamConfig>>;
  providerName: string;
  worktreePath?: string;
  branchName?: string;
};

/**
 * Structured handling of classified provider failures.
 *
 * Retry safety policy (Phase 13):
 * - The task worktree is NEVER removed or recreated on a provider failure.
 *   Partial changes from the failed attempt stay on the task branch and the
 *   retry runs in the same worktree, so no diagnostics are lost and the
 *   agent can inspect what was already done.
 */
async function handleProviderFailure(
  context: ProviderFailureContext,
): Promise<DispatchResult> {
  const { request, error, teamConfig, providerName } = context;

  const retryConfig = resolveProviderConfig(teamConfig, providerName).retry;

  console.log("");
  console.log(
    `⚠ ${request.task_id} ${request.agent} provider failure ` +
      `(${error.kind}${error.statusCode ? `, status ${error.statusCode}` : ""})`,
  );

  if (error.retryable) {
    const outcome = await applyProviderRetry({
      request,
      error,
      retryConfig,
    });

    if (outcome.outcome === "retry_wait") {
      console.log(`    provider: ${error.provider}`);
      console.log(`    error: ${error.kind}`);
      if (error.statusCode !== undefined) {
        console.log(`    status: ${error.statusCode}`);
      }
      console.log(`    retry at: ${outcome.retryNotBefore}`);
      console.log(
        `    attempt: ${outcome.attempt}/${outcome.maxAttempts}`,
      );

      if (context.worktreePath) {
        console.log(
          `    worktree preserved for retry: ${context.worktreePath}`,
        );
      }

      return {
        taskId: request.task_id,
        agent: request.agent,
        status: "retry_wait",
        summary:
          `Transient provider failure (${error.kind}); ` +
          `retry scheduled at ${outcome.retryNotBefore}.`,
        branch: context.branchName,
        worktree: context.worktreePath,
        diagnostics: [describeError(error)],
      };
    }

    // Budget exhausted → blocked.
    console.log(`    provider: ${error.provider}`);
    console.log(`    error: ${error.kind}`);
    console.log(
      `    attempt: ${outcome.attempt}/${outcome.maxAttempts} — budget exhausted, task blocked`,
    );

    return {
      taskId: request.task_id,
      agent: request.agent,
      status: "blocked",
      summary:
        `Transient provider failure (${error.kind}) exhausted the retry budget ` +
        `(${outcome.attempt}/${outcome.maxAttempts}).`,
      branch: context.branchName,
      worktree: context.worktreePath,
      diagnostics: [describeError(error)],
    };
  }

  await applyPermanentProviderFailure({ request, error });

  console.log(`    provider: ${error.provider}`);
  console.log(`    error: ${error.kind}`);
  console.log(`    retryable: false — task failed`);

  return {
    taskId: request.task_id,
    agent: request.agent,
    status: "failed",
    summary:
      `Permanent provider failure (${error.kind}). ` +
      `Worktree preserved with partial changes.`,
    branch: context.branchName,
    worktree: context.worktreePath,
    diagnostics: [describeError(error)],
  };
}

function describeError(error: ProviderError): string {
  const parts = [
    `provider=${error.provider}`,
    `kind=${error.kind}`,
    `retryable=${error.retryable}`,
  ];

  if (error.statusCode !== undefined) {
    parts.push(`status=${error.statusCode}`);
  }

  parts.push(`message=${error.message.slice(0, 300)}`);

  return parts.join(" ");
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner(): Promise<void> {
    while (true) {
      const current = nextIndex;

      if (current >= items.length) {
        return;
      }

      nextIndex += 1;
      results[current] = await worker(items[current]);
    }
  }

  const workers = Array.from(
    {
      length: Math.min(concurrency, items.length),
    },
    () => runner(),
  );

  await Promise.all(workers);
  return results;
}

function printSummary(results: DispatchResult[]): void {
  console.log("");
  console.log("Dispatch summary");
  console.log("────────────────────────────────────────");

  for (const result of results) {
    const icon =
      result.status === "completed"
        ? "✓"
        : result.status === "retry_wait"
          ? "⏳"
          : result.status === "blocked"
            ? "!"
            : result.status === "failed"
              ? "✗"
              : "⚠";

    console.log(
      `${icon} ${result.taskId.padEnd(14)} ${result.agent.padEnd(10)} ${result.status}`,
    );

    if (result.branch) {
      console.log(`    branch: ${result.branch}`);
    }

    if (result.worktree) {
      console.log(`    worktree: ${result.worktree}`);
    }
    if (result.status === "error") {
      console.log(`    error: ${result.summary}`);
    }

    if (result.diagnostics?.length) {
      for (const line of result.diagnostics) {
        console.log(`    diagnostic: ${line}`);
      }
    }

    if (result.commit) {
      console.log(`    commit: ${result.commit}`);
    }
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  try {
    await assertCleanWorkingTree();

    const teamConfig = await loadTeamConfig();
    const execution = resolveExecutionConfig(teamConfig);
    const providerName = resolveDefaultProviderName(teamConfig);
    const provider = getExecutionProvider(providerName);

    // Defensive capacity enforcement: even if the scheduler miscounted,
    // the dispatcher never exceeds provider concurrency.
    const providerCapacity = provider.getCapacity(teamConfig);

    const dispatchConcurrency = Math.max(
      1,
      Math.min(execution.max_parallel_agents, providerCapacity.maxConcurrency),
    );

    const state = await loadState(cli.workflowId);

    if (state.status === "completed" || state.status === "cancelled") {
      fail(
        `Workflow "${state.workflow_id}" cannot be dispatched (${state.status}).`,
      );
    }

    const requestFiles = await listRequestFiles(
      state.workflow_id,
      execution.requests_directory,
    );

    const requests: ExecutionRequest[] = [];

    for (const file of requestFiles) {
      try {
        const request = await loadJson<ExecutionRequest>(file);

        if (isDispatchableRequest(request, state)) {
          requests.push(request);
        }
      } catch {
        // ignore invalid request files
      }
    }

    if (!requests.length) {
      console.log("No dispatchable execution requests found.");
      return;
    }

    console.log(
      `Dispatching ${requests.length} task(s) via provider "${providerName}" ` +
        `with isolated Git worktrees (concurrency: ${dispatchConcurrency})...`,
    );

    const results = await runPool(requests, dispatchConcurrency, (request) =>
      executeRequest(request, providerName),
    );

    printSummary(results);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
