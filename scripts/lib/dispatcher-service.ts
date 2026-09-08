/**
 * Phase 14 — Reusable dispatcher service.
 *
 * Extracted from scripts/dispatch-workflow.ts so a future CLI can dispatch
 * claimed execution requests without spawning the script. Behavior is
 * unchanged:
 *
 *   - only requests whose task is in_progress with a matching lease run
 *   - each task executes in an isolated Git worktree
 *   - provider failures flow through the Phase 13 retry transitions
 *   - task worktrees are NEVER removed or recreated on failure
 *
 * Progress lines are emitted through the optional `onEvent` callback
 * instead of the console. This module never exits the process.
 */

import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import type { AgentResult } from "./agent-result.js";
import type { ExecutionRequest } from "./execution-request.js";
import type { WorkflowState } from "./types.js";
import type { TeamConfig } from "./team-config.js";

import {
  loadTeamConfig,
  resolveDefaultProviderName,
  resolveExecutionConfig,
  resolveProviderConfig,
} from "./team-config.js";

import { getExecutionProvider } from "./providers/provider-registry.js";

import { ProviderError } from "./providers/provider-error.js";

import {
  applyPermanentProviderFailure,
  applyProviderRetry,
  maybeRecordProviderRecovery,
} from "./provider-retry.js";

import { finalizeTaskWorktree } from "./task-finalizer.js";

import {
  appendHistory,
  deriveWorkflowStatus,
  loadJson,
  loadState,
  saveState,
  workflowDir,
} from "./workflow-store.js";

import {
  createTaskWorktree,
  getWorktreeDiff,
} from "./git-worktree.js";

export type DispatchOutcome =
  | "completed"
  | "failed"
  | "blocked"
  | "retry_wait";

export type DispatchProviderErrorInfo = {
  kind: string;
  retryable: boolean;
  message: string;
  statusCode?: number;
  /** Persisted retry time; present for retry_wait outcomes. */
  nextRetryAt?: string;
};

export type DispatchTaskOutcome = {
  taskId: string;
  agent: string;
  outcome: DispatchOutcome;
  providerError?: DispatchProviderErrorInfo;
  detail?: string;
  branch?: string;
  worktree?: string;
  commit?: string;
  diagnostics?: string[];
  /**
   * True when the failure came from orchestration itself (worktree
   * creation, state application) rather than from the provider.
   */
  isError?: boolean;
};

export type DispatchCounts = {
  total: number;
  completed: number;
  failed: number;
  blocked: number;
  retry_wait: number;
  /** Orchestration-level errors counted under failed. */
  errors: number;
};

export type DispatchSummary = {
  results: DispatchTaskOutcome[];
  counts: DispatchCounts;
};

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
  providerError?: DispatchProviderErrorInfo;
};

/**
 * All execution requests that are currently dispatchable: the request file
 * exists and its task is in_progress with a matching active lease.
 */
export async function listDispatchableRequests(
  state: WorkflowState,
): Promise<ExecutionRequest[]> {
  const teamConfig = await loadTeamConfig();

  const execution = resolveExecutionConfig(teamConfig);

  const directory = resolve(
    workflowDir(state.workflow_id),
    execution.requests_directory,
  );

  let files: string[];

  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });

    files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => resolve(directory, entry.name));
  } catch {
    return [];
  }

  const requests: ExecutionRequest[] = [];

  for (const file of files) {
    try {
      const request = await loadJson<ExecutionRequest>(file);

      if (isDispatchableRequest(request, state)) {
        requests.push(request);
      }
    } catch {
      // ignore invalid request files
    }
  }

  return requests;
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

/**
 * Defensive capacity enforcement used by the CLI wrapper: even if the
 * scheduler miscounted, the dispatcher never exceeds provider concurrency.
 */
export function resolveDispatchConcurrency(teamConfig: TeamConfig): number {
  const execution = resolveExecutionConfig(teamConfig);

  const providerName = resolveDefaultProviderName(teamConfig);

  const provider = getExecutionProvider(providerName);

  const providerCapacity = provider.getCapacity(teamConfig);

  return Math.max(
    1,
    Math.min(execution.max_parallel_agents, providerCapacity.maxConcurrency),
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
  teamConfig: Awaited<ReturnType<typeof loadTeamConfig>>,
  providerName: string,
  onEvent: (line: string) => void,
): Promise<DispatchResult> {
  const provider = getExecutionProvider(providerName);

  const baseRef = request.task_id.startsWith("FIX-")
    ? `amiral/${request.workflow_id}/integration`
    : "HEAD";

  let worktreePath: string | undefined;
  let branchName: string | undefined;
  let materializedArtifacts: string[] = [];

  try {
    const worktree = await createTaskWorktree(
      request.workflow_id,
      request.task_id,
      baseRef,
    );

    worktreePath = worktree.worktreePath;
    branchName = worktree.branchName;

    materializedArtifacts = await materializeTaskArtifacts(request, worktree.worktreePath);

    onEvent(`[${request.task_id}] worktree: ${worktree.worktreePath}`);

    const output = await provider.execute({
      request,
      teamConfig,
      cwd: worktree.worktreePath,
    });

    const result = output.result!;

    // Do not include orchestration-owned copies in a successful task commit.
    await Promise.all(materializedArtifacts.map(file => rm(file, { force: true })));
    materializedArtifacts = [];

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
        onEvent,
      });
    }

    const detail = error instanceof Error ? error.message : String(error);
    try {
      await failLeasedTask(request, detail);
    } catch (persistenceError) {
      throw new Error(`Orchestration failed for ${request.task_id}: ${detail}; failed to persist recoverable state: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`, { cause: error });
    }
    return { taskId: request.task_id, agent: request.agent, status: "error", summary: detail, branch: branchName, worktree: worktreePath };
  } finally {
    // Cleanup runs for success and every provider failure path. It must never
    // replace the original provider error or alter its retry classification.
    await Promise.all(materializedArtifacts.map(file => rm(file, { force: true }).catch(() => undefined)));
  }
}

/** Copies orchestration artifacts into the isolated task cwd and rewrites refs to local paths. */
export async function materializeTaskArtifacts(request: ExecutionRequest, worktreePath: string): Promise<string[]> {
  const refs = request.context.artifact_refs;
  if (!refs?.length) return [];
  const root = resolve(process.cwd());
  const integrationGates = resolve(root, ".amiral", "integration", request.workflow_id.toLowerCase(), ".amiral", "gates");
  const artifactDir = resolve(worktreePath, ".amiral", "artifacts");
  const local: string[] = [];
  const copied: string[] = [];
  try {
    for (const ref of refs) {
      if (ref.includes("\0")) throw new Error("Artifact reference contains invalid characters.");
      let source: string;
      let sourceIdentity: string;
      let approvedRoot: string;
      if (ref.startsWith(".amiral/gates/")) {
        const file = basename(ref);
        if (!/^visual-qa-iteration-\d+\.json$/.test(file) || ref !== `.amiral/gates/${file}`) {
          throw new Error(`Artifact reference is not an approved gate artifact: ${ref}`);
        }
        source = resolve(integrationGates, file);
        approvedRoot = resolve(root, ".amiral", "integration");
        sourceIdentity = `gate:${request.workflow_id.toLowerCase()}/${file}`;
      } else {
        source = resolve(root, ref);
        const rel = relative(root, source).replace(/\\/g, "/");
        const approvedDesignSource = basename(source) === "uiux-design-spec.json"
          && (rel === "uiux-design-spec.json" || /^(plans|tasks)\/[^/]+\/uiux-design-spec\.json$/.test(rel));
        if (isAbsolute(rel) || rel.startsWith("../") || !approvedDesignSource) {
          throw new Error(`Artifact reference is outside approved artifact roots or has an unsupported type: ${ref}`);
        }
        approvedRoot = rel === "uiux-design-spec.json" ? root : resolve(root, rel.split("/")[0]);
        sourceIdentity = `design:${rel}`;
      }
      const sourceStat = await lstat(source);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Artifact source must be a regular non-symlink file: ${ref}`);
      const [physicalSource, physicalApprovedRoot] = await Promise.all([realpath(source), realpath(approvedRoot)]);
      const physicalRelative = relative(physicalApprovedRoot, physicalSource);
      if (physicalRelative.startsWith("..") || isAbsolute(physicalRelative)) {
        throw new Error(`Artifact source resolves outside its approved root: ${ref}`);
      }
      const suffix = createHash("sha256").update(sourceIdentity).digest("hex").slice(0, 16);
      const destinationRef = `.amiral/artifacts/${suffix}-${basename(source)}`;
      const destination = resolve(worktreePath, destinationRef);
      const relDestination = relative(resolve(worktreePath), destination);
      if (relDestination.startsWith("..") || isAbsolute(relDestination) || dirname(destination) !== artifactDir) throw new Error(`Artifact destination escapes task artifact namespace: ${ref}`);
      await mkdir(artifactDir, { recursive: true });
      const namespaceParts = [resolve(worktreePath, ".amiral"), artifactDir];
      if ((await Promise.all(namespaceParts.map(part => lstat(part)))).some(stat => stat.isSymbolicLink())) {
        throw new Error("Task artifact namespace must not contain symbolic links.");
      }
      // Never overwrite a tracked (or otherwise pre-existing) worktree path.
      await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
      copied.push(destination);
      local.push(destinationRef);
    }
  } catch (error) {
    await Promise.all(copied.map(file => rm(file, { force: true }).catch(() => undefined)));
    throw error;
  }
  request.context.artifact_refs = local;
  return copied;
}

async function failLeasedTask(request: ExecutionRequest, detail: string): Promise<void> {
  const state = await loadState(request.workflow_id);
  const task = state.tasks.find((item) => item.id === request.task_id);
  if (!task || task.status !== "in_progress" || task.lease_id !== request.lease_id) {
    throw new Error(`Cannot fail task ${request.task_id}: active lease no longer matches.`);
  }
  const previousWorkflowStatus = state.status;
  task.status = "failed";
  task.lease_id = null;
  task.lease_expires_at = null;
  task.started_at = null;
  task.completed_at = null;
  task.last_error = detail;
  state.status = deriveWorkflowStatus(state);
  const timestamp = new Date().toISOString();
  await saveState(state);
  await appendHistory({ timestamp, workflow_id: state.workflow_id, event: "task_status_changed", task_id: task.id, message: `in_progress -> failed (orchestration error: ${detail})` });
  if (previousWorkflowStatus !== state.status) await appendHistory({ timestamp, workflow_id: state.workflow_id, event: "workflow_status_changed", message: `${previousWorkflowStatus} -> ${state.status}` });
}

type ProviderFailureContext = {
  request: ExecutionRequest;
  error: ProviderError;
  teamConfig: Awaited<ReturnType<typeof loadTeamConfig>>;
  providerName: string;
  worktreePath?: string;
  branchName?: string;
  onEvent: (line: string) => void;
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
  const { request, error, teamConfig, providerName, onEvent } = context;

  const retryConfig = resolveProviderConfig(teamConfig, providerName).retry;

  const providerErrorInfo: DispatchProviderErrorInfo = {
    kind: error.kind,
    retryable: error.retryable,
    message: error.message,
    ...(error.statusCode !== undefined
      ? { statusCode: error.statusCode }
      : {}),
  };

  onEvent("");
  onEvent(
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
      onEvent(`    provider: ${error.provider}`);
      onEvent(`    error: ${error.kind}`);
      if (error.statusCode !== undefined) {
        onEvent(`    status: ${error.statusCode}`);
      }
      onEvent(`    retry at: ${outcome.retryNotBefore}`);
      onEvent(
        `    attempt: ${outcome.attempt}/${outcome.maxAttempts}`,
      );

      if (context.worktreePath) {
        onEvent(
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
        providerError: {
          ...providerErrorInfo,
          nextRetryAt: outcome.retryNotBefore,
        },
      };
    }

    // Budget exhausted → blocked.
    onEvent(`    provider: ${error.provider}`);
    onEvent(`    error: ${error.kind}`);
    onEvent(
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
      providerError: providerErrorInfo,
    };
  }

  await applyPermanentProviderFailure({ request, error });

  onEvent(`    provider: ${error.provider}`);
  onEvent(`    error: ${error.kind}`);
  onEvent(`    retryable: false — task failed`);

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
    providerError: providerErrorInfo,
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

function toTaskOutcome(result: DispatchResult): DispatchTaskOutcome {
  if (result.status === "error") {
    return {
      taskId: result.taskId,
      agent: result.agent,
      outcome: "failed",
      detail: result.summary,
      isError: true,
      ...(result.branch ? { branch: result.branch } : {}),
      ...(result.worktree ? { worktree: result.worktree } : {}),
    };
  }

  return {
    taskId: result.taskId,
    agent: result.agent,
    outcome: result.status,
    ...(result.providerError
      ? { providerError: result.providerError }
      : {}),
    detail: result.summary,
    ...(result.branch ? { branch: result.branch } : {}),
    ...(result.worktree ? { worktree: result.worktree } : {}),
    ...(result.commit ? { commit: result.commit } : {}),
    ...(result.diagnostics?.length
      ? { diagnostics: result.diagnostics }
      : {}),
  };
}

export type DispatchRequestsOptions = {
  requests: ExecutionRequest[];
  teamConfig: TeamConfig;
  concurrency?: number;
  onEvent?: (line: string) => void;
};

/**
 * Dispatch execution requests through the configured provider with bounded
 * concurrency. Per-task failures never reject the whole batch; they are
 * reported as structured outcomes.
 */
export async function dispatchRequests(
  options: DispatchRequestsOptions,
): Promise<DispatchSummary> {
  const { requests, teamConfig } = options;

  const concurrency =
    options.concurrency ?? resolveDispatchConcurrency(teamConfig);

  const onEvent = options.onEvent ?? (() => {});

  const providerName = resolveDefaultProviderName(teamConfig);

  const results = await runPool(requests, concurrency, (request) =>
    executeRequest(request, teamConfig, providerName, onEvent),
  );

  const outcomes = results.map(toTaskOutcome);

  const counts: DispatchCounts = {
    total: outcomes.length,
    completed: 0,
    failed: 0,
    blocked: 0,
    retry_wait: 0,
    errors: 0,
  };

  for (const outcome of outcomes) {
    counts[outcome.outcome] += 1;

    if (outcome.isError) {
      counts.errors += 1;
    }
  }

  return { results: outcomes, counts };
}
