/**
 * Phase 14 STAGE 1b — The `amiral run` engine.
 *
 * Runs the full orchestration loop for one workflow until a pause-worthy
 * condition is reached, composing the Stage 1a services:
 *
 *   scheduling-service -> dispatcher-service -> gates-service ->
 *   review-fix-service (+ team-config quality settings)
 *
 * Stop reasons (`RunStopReason`):
 *
 *   completed        all tasks done, review PASS, QA PASS (workflow completed)
 *   failed           at least one task failed (non-retryable path exhausted)
 *   blocked          workflow or any task is blocked
 *   retry_scheduled  nothing claimable and transient retries are pending
 *   needs_input      human decision required (cancelled, gate BLOCKED,
 *                    QA FAIL/BLOCKED, review-fix exhausted without progress)
 *   max_review_rounds CHANGES_REQUESTED persisted past quality.max_review_rounds
 *                    or produced no new fix tasks -> workflow set blocked
 *   no_progress      nothing schedulable and nothing pending a timer
 *   interrupted      abort signal observed before further mutation
 *
 * The loop is hard-bounded by `maxIterations` (default 25) as a safety net
 * against uncontrolled loops. This module never writes to the console and
 * never exits the process; progress lines flow through `onEvent`.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { WorkflowState } from "./types.js";
import type { RetryWaitingInfo } from "./scheduling-service.js";

import {
  appendHistory,
  loadState,
  saveState,
} from "./workflow-store.js";

import { assertCleanWorkingTree } from "./git-worktree.js";

import {
  branchExists,
  createIntegrationWorkspace,
  getTaskBranchName,
  isBranchMerged,
  mergeTaskBranch,
} from "./integration.js";

import { scheduleOnce } from "./scheduling-service.js";
import {
  dispatchRequests,
  listDispatchableRequests,
} from "./dispatcher-service.js";
import { runQaGate, runReviewGate } from "./gates-service.js";
import { applyReviewFixRound } from "./review-fix-service.js";
import {
  loadTeamConfig,
  resolveQualityConfig,
} from "./team-config.js";

export type RunStopReason =
  | "completed"
  | "blocked"
  | "failed"
  | "retry_scheduled"
  | "needs_input"
  | "no_progress"
  | "interrupted"
  | "max_review_rounds";

/** Compact per-iteration log line used for verbose output. */
export type RunIteration = {
  iteration: number;
  summary: string;
};

export type RunOutcome = {
  reason: RunStopReason;
  workflowId: string;
  status: WorkflowState["status"];
  message: string;
  nextRetryAt?: string;
  /** Per-iteration log lines (verbose mode). */
  detail?: RunIteration[];
};

export type RunWorkflowOptions = {
  workflowId?: string;
  maxIterations?: number;
  signal?: { aborted: boolean };
  onEvent?: (line: string) => void;
};

const DEFAULT_MAX_ITERATIONS = 25;

function isGateAgent(agent: string): boolean {
  return agent === "reviewer" || agent === "qa";
}

/**
 * True when a QA result artifact with verdict PASS exists for the
 * workflow. Used to distinguish a legitimate completion (QA gate passed)
 * from the dispatcher-derived intermediate "all tasks completed" status
 * that precedes the quality gates.
 */
export async function hasPassingQaResult(workflowId: string): Promise<boolean> {
  const file = resolve(
    process.cwd(),
    ".amiral",
    "integration",
    workflowId.toLowerCase(),
    ".amiral",
    "gates",
    "qa-result.json",
  );

  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as {
      workflow_id?: unknown;
      status?: unknown;
    };

    return (
      parsed.workflow_id === workflowId &&
      parsed.status === "PASS"
    );
  } catch {
    return false;
  }
}

/**
 * Earliest pending retry time across waiting tasks, or undefined when the
 * timestamps are missing/invalid. Exported for tests.
 */
export function computeNextRetryAt(
  waitingRetries: Array<Pick<RetryWaitingInfo, "retryAt">>,
): string | undefined {
  let best: number | null = null;

  for (const info of waitingRetries) {
    if (!info.retryAt) {
      continue;
    }

    const parsed = Date.parse(info.retryAt);

    if (!Number.isFinite(parsed)) {
      continue;
    }

    if (best === null || parsed < best) {
      best = parsed;
    }
  }

  return best === null ? undefined : new Date(best).toISOString();
}

/**
 * Idempotent integration phase: merge every completed implementation and
 * FIX task branch into the integration worktree. Already-merged branches
 * are detected via ancestry and skipped, so repeating the phase never
 * produces duplicate merge commits.
 */
async function runIntegrationPhase(
  state: WorkflowState,
  onEvent: (line: string) => void,
): Promise<void> {
  await assertCleanWorkingTree();

  const workspace = await createIntegrationWorkspace(state.workflow_id);

  onEvent(`[integration] workspace ready: ${workspace.worktreePath}`);

  const completedImpl = state.tasks.filter(
    (task) => task.status === "completed" && !isGateAgent(task.agent),
  );

  // Plain implementation branches first, then FIX branches which are based
  // on the integration branch and must land on top of them.
  const ordered = [
    ...completedImpl.filter((task) => !task.id.startsWith("FIX-")),
    ...completedImpl.filter((task) => task.id.startsWith("FIX-")),
  ];

  for (const task of ordered) {
    const branch = getTaskBranchName(state.workflow_id, task.id);

    if (!(await branchExists(branch))) {
      onEvent(`[integration] skip ${task.id}: branch ${branch} does not exist`);
      continue;
    }

    if (await isBranchMerged(workspace.worktreePath, branch)) {
      onEvent(`[integration] already merged: ${branch}`);
      continue;
    }

    await mergeTaskBranch(workspace.worktreePath, branch);

    onEvent(`[integration] merged ${branch}`);
  }
}

/**
 * Set the workflow to blocked and record why. Used when the review-fix
 * loop cannot make progress anymore.
 */
async function blockWorkflow(
  workflowId: string,
  message: string,
): Promise<void> {
  const state = await loadState(workflowId);

  state.status = "blocked";
  await saveState(state);

  await appendHistory({
    timestamp: new Date().toISOString(),
    workflow_id: workflowId,
    event: "workflow_status_changed",
    message,
  });
}

/**
 * Review/QA gate stage executed once every non-gate task is completed.
 * Returns an outcome to stop with, or null to continue the loop
 * (fix tasks were scheduled for the next iteration).
 */
async function runQualityGates(
  workflowId: string,
  onEvent: (line: string) => void,
): Promise<RunOutcome | null> {
  const review = await runReviewGate({ workflowId, onEvent });

  onEvent(
    `[gate] review verdict: ${review.verdict} — ${review.summary}`,
  );

  if (review.verdict === "BLOCKED") {
    return {
      reason: "needs_input",
      workflowId,
      status: (await loadState(workflowId)).status,
      message: `Review gate is blocked: ${review.summary}`,
    };
  }

  if (review.verdict === "PASS") {
    const qa = await runQaGate({ workflowId, onEvent });

    onEvent(`[gate] qa verdict: ${qa.verdict} — ${qa.summary}`);

    if (qa.verdict === "PASS") {
      return {
        reason: "completed",
        workflowId,
        status: (await loadState(workflowId)).status,
        message: `Workflow completed. QA summary: ${qa.summary}`,
      };
    }

    return {
      reason: "needs_input",
      workflowId,
      status: (await loadState(workflowId)).status,
      message: `QA gate ${qa.verdict}: ${qa.summary}`,
    };
  }

  // CHANGES_REQUESTED: apply one review-fix round and decide whether the
  // loop may continue.
  const teamConfig = await loadTeamConfig();
  const maxReviewRounds =
    resolveQualityConfig(teamConfig).max_review_rounds;

  const fixRound = await applyReviewFixRound({ workflowId });

  const exhausted =
    fixRound.round > maxReviewRounds ||
    fixRound.createdTasks.length === 0;

  if (exhausted) {
    await blockWorkflow(
      workflowId,
      "maximum review rounds reached",
    );

    return {
      reason: "max_review_rounds",
      workflowId,
      status: "blocked",
      message:
        `Maximum review rounds reached (${maxReviewRounds}); ` +
        `workflow blocked after review round ${fixRound.round}. ` +
        `Last review summary: ${fixRound.summary}`,
    };
  }

  onEvent(
    `[review-fix] round ${fixRound.round}: created ` +
      `${fixRound.createdTasks.map((task) => task.id).join(", ")}`,
  );

  // Fix tasks are now pending; the next iteration schedules them.
  return null;
}

function describeNoProgress(state: WorkflowState): string {
  const waitingOnDependencies = state.tasks.filter((task) => {
    if (task.status !== "pending") {
      return false;
    }

    return task.dependencies.some((dependencyId) => {
      const dependency = state.tasks.find(
        (item) => item.id === dependencyId,
      );

      return dependency && dependency.status !== "completed";
    });
  });

  if (waitingOnDependencies.length) {
    const lines = waitingOnDependencies
      .map((task) => `${task.id} (waiting on: ${task.dependencies.join(", ")})`)
      .join("; ");

    return (
      `No schedulable tasks. Pending on dependencies: ${lines}. ` +
      `Inspect 'amiral status' for details.`
    );
  }

  return (
    "No schedulable tasks and nothing is pending a retry. " +
    "Inspect 'amiral status' and 'amiral history' for details."
  );
}

/**
 * Run the orchestration loop for one workflow until it pauses.
 */
export async function runWorkflowUntilPause(
  options: RunWorkflowOptions = {},
): Promise<RunOutcome> {
  const maxIterations =
    options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const onEvent = options.onEvent ?? (() => {});

  const detail: RunIteration[] = [];

  let workflowId: string | undefined = options.workflowId?.trim() ||
    undefined;

  for (
    let iteration = 1;
    iteration <= maxIterations;
    iteration += 1
  ) {
    const state: WorkflowState = await loadState(workflowId);

    workflowId = state.workflow_id;

    if (state.status === "completed") {
      // A dispatcher-derived "completed" (all impl tasks done) precedes the
      // quality gates. Only treat completion as final when a passing QA
      // result exists; otherwise fall through so the gates can run.
      if (await hasPassingQaResult(state.workflow_id)) {
        return {
          reason: "completed",
          workflowId: state.workflow_id,
          status: state.status,
          message: "Workflow is already completed.",
          ...(detail.length ? { detail } : {}),
        };
      }
    } else if (state.status === "cancelled") {
      return {
        reason: "needs_input",
        workflowId: state.workflow_id,
        status: state.status,
        message: "Workflow cancelled.",
        ...(detail.length ? { detail } : {}),
      };
    }

    if (options.signal?.aborted) {
      // Stop WITHOUT mutating anything further.
      return {
        reason: "interrupted",
        workflowId: state.workflow_id,
        status: state.status,
        message: "Run interrupted before the next iteration.",
        ...(detail.length ? { detail } : {}),
      };
    }

    // The dispatcher marks a workflow completed as soon as all implementation
    // tasks finish. That is an intermediate state until review and QA pass;
    // scheduling rejects completed workflows, so run the gates before asking
    // the scheduler for another claim.
    if (state.status === "completed") {
      await runIntegrationPhase(state, onEvent);
      const outcome = await runQualityGates(state.workflow_id, onEvent);
      if (outcome) return { ...outcome, ...(detail.length ? { detail } : {}) };
      detail.push({ iteration, summary: "quality gates requested changes; fix tasks scheduled" });
      continue;
    }

    const schedule = await scheduleOnce({ state });

    for (const line of schedule.lines) {
      onEvent(line);
    }

    if (schedule.claims.length > 0) {
      const refreshed = await loadState(state.workflow_id);

      const claimedIds = new Set(schedule.claims.map((claim) => claim.taskId));

      const requests = (await listDispatchableRequests(refreshed)).filter(
        (request) => claimedIds.has(request.task_id),
      );

      const teamConfig = await loadTeamConfig();

      const summary = await dispatchRequests({
        requests,
        teamConfig,
        onEvent,
      });

      const counts = summary.counts;

      detail.push({
        iteration,
        summary:
          `dispatched ${claimsSummary(schedule.claims)} -> ` +
          `completed=${counts.completed}, failed=${counts.failed}, ` +
          `blocked=${counts.blocked}, retry_wait=${counts.retry_wait}`,
      });

      if (counts.retry_wait > 0) {
        const retryState = await loadState(state.workflow_id);
        const nextRetryAt = computeNextRetryAt(
          retryState.tasks
            .filter((task) => task.status === "retry_wait")
            .map((task) => ({ taskId: task.id, retryAt: task.retry_not_before ?? null })),
        );
        return {
          reason: "retry_scheduled",
          workflowId: retryState.workflow_id,
          status: retryState.status,
          message: `Workflow paused. Next retry: ${nextRetryAt ?? "<unknown>"}.`,
          ...(nextRetryAt ? { nextRetryAt } : {}),
          detail,
        };
      }

      continue;
    }

    // No claims this round: evaluate the pause conditions in order.
    const fresh = await loadState(state.workflow_id);

    // a) Failed tasks (the dispatcher already applied the non-retryable
    //    transition) stop the run immediately.
    const failed = fresh.tasks.filter((task) => task.status === "failed");

    if (failed.length > 0) {
      const ids = failed.map((task) => task.id).join(", ");

      return {
        reason: "failed",
        workflowId: fresh.workflow_id,
        status: fresh.status,
        message:
          `Task(s) failed: ${ids}. Inspect the results, then run ` +
          `'amiral retry <task-id>' to schedule a manual retry.`,
        ...(detail.length ? { detail } : {}),
      };
    }

    // b) Workflow or task-level blocking.
    if (
      fresh.status === "blocked" ||
      fresh.tasks.some((task) => task.status === "blocked")
    ) {
      const blockedIds = fresh.tasks
        .filter((task) => task.status === "blocked")
        .map((task) => task.id)
        .join(", ");

      return {
        reason: "blocked",
        workflowId: fresh.workflow_id,
        status: fresh.status,
        message: blockedIds
          ? `Workflow blocked. Blocked task(s): ${blockedIds}.`
          : "Workflow blocked.",
        ...(detail.length ? { detail } : {}),
      };
    }

    // c) Every non-gate task (implementation + FIX tasks) completed and at
    //    least one exists: integrate branches, then run review and QA gates.
    const nonGate = fresh.tasks.filter((task) => !isGateAgent(task.agent));

    if (
      nonGate.length > 0 &&
      nonGate.every((task) => task.status === "completed")
    ) {
      await runIntegrationPhase(fresh, onEvent);

      const outcome = await runQualityGates(fresh.workflow_id, onEvent);

      if (outcome) {
        return { ...outcome, ...(detail.length ? { detail } : {}) };
      }

      detail.push({
        iteration,
        summary: "quality gates requested changes; fix tasks scheduled",
      });

      continue;
    }

    // d) Nothing claimable but transient provider retries are pending.
    if (schedule.waitingRetries.length > 0) {
      const nextRetryAt = computeNextRetryAt(schedule.waitingRetries);

      return {
        reason: "retry_scheduled",
        workflowId: fresh.workflow_id,
        status: fresh.status,
        message: `Workflow paused. Next retry: ${nextRetryAt ?? "<unknown>"}.`,
        ...(nextRetryAt ? { nextRetryAt } : {}),
        ...(detail.length ? { detail } : {}),
      };
    }

    // e) Nothing actionable.
    return {
      reason: "no_progress",
      workflowId: fresh.workflow_id,
      status: fresh.status,
      message: describeNoProgress(fresh),
      ...(detail.length ? { detail } : {}),
    };
  }

  // Safety bound exhausted: never spin forever.
  const state = await loadState(workflowId);

  return {
    reason: "needs_input",
    workflowId: state.workflow_id,
    status: state.status,
    message:
      `Stopped after ${maxIterations} iterations (safety bound) while still ` +
      `making progress. Resume with another run.`,
    ...(detail.length ? { detail } : {}),
  };
}

function claimsSummary(
  claims: Array<{ taskId: string; agent: string }>,
): string {
  return claims
    .map((claim) => `${claim.taskId}[${claim.agent}]`)
    .join(", ");
}
