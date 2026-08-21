/**
 * Phase 14 — Reusable scheduling service.
 *
 * Extracted from scripts/run-workflow.ts so a future CLI (or any other
 * entry point) can schedule workflow rounds without spawning the script.
 * The service performs exactly what the script did:
 *
 *   - recover expired leases (persisted history events preserved)
 *   - promote due retry_wait tasks back to pending
 *   - select ready tasks up to the effective parallelism
 *     min(execution.max_parallel_agents, provider.maxConcurrency)
 *   - route tasks through capability routing
 *   - claim tasks (lease id/expiry, attempt semantics unchanged) and
 *     write execution request files unless dryRun
 *
 * NEW in Phase 14 — conflict-domain hold: after selecting candidates, a
 * candidate that is dependency-independent from an actively leased task
 * AND shares a `planning.conflict_domains` entry with it is NOT claimed
 * this round. The hold is advisory: it is only recorded in the result,
 * never persisted as state or history.
 *
 * This module never writes to the console and never exits the process.
 */

import { randomUUID } from "node:crypto";

import type {
  AgentName,
  RuntimeTask,
  WorkflowState,
} from "./types.js";

import type { RoutingDecision } from "./capability-scheduler.js";
import type { ProviderCapacity } from "./provider-capacity.js";
import type { TeamConfig } from "./team-config.js";

import { findReadyTasks } from "./task-graph.js";
import { areDependencyIndependent } from "./task-graph-analysis.js";

import {
  loadTeamConfig,
  resolveDefaultProviderName,
  resolveExecutionConfig,
} from "./team-config.js";

import { writeExecutionRequest } from "./execution-request.js";

import {
  appendHistory,
  deriveWorkflowStatus,
  loadState,
  saveState,
} from "./workflow-store.js";

import { routeReadyTasks } from "./scheduler-routing.js";

import { getProviderCapacity } from "./provider-capacity.js";

import {
  findWaitingRetryTasks,
  promoteDueRetries,
} from "./scheduler-retry.js";

export type ClaimedTask = {
  taskId: string;
  agent: AgentName;
  title: string;
  /**
   * Relative path of the written execution request. In dry-run mode no
   * file is written and this is the path that WOULD have been written.
   */
  requestFile: string;
};

export type RetryWaitingInfo = {
  taskId: string;
  agent: AgentName;
  provider: string | null;
  kind: string | null;
  retryAt: string | null;
  attempts: number;
  maxAttempts: number | null;
};

export type SkippedByCapability = {
  taskId: string;
  reason: string;
};

export type ConflictHold = {
  taskId: string;
  againstTaskId: string;
  domain: string;
};

export type ExpiredLeaseInfo = {
  taskId: string;
  attempts: number;
  maxAttempts: number;
};

export type ScheduleOnceResult = {
  workflowId: string;
  /** True when the workflow is blocked and nothing was scheduled. */
  blocked: boolean;
  providerName: string;
  providerMaxConcurrency: number;
  teamMaxParallel: number;
  effectiveParallelism: number;
  leaseMinutes: number;
  maxAttempts: number;
  expiredLeases: ExpiredLeaseInfo[];
  waitingRetries: RetryWaitingInfo[];
  routingDecisions: RoutingDecision[];
  claims: ClaimedTask[];
  skippedByCapability: SkippedByCapability[];
  conflictHolds: ConflictHold[];
  /** Human-readable progress lines for callers that want them. */
  lines: string[];
};

function leaseExpiration(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isLeaseExpired(task: RuntimeTask): boolean {
  if (task.status !== "in_progress") {
    return false;
  }

  if (!task.lease_expires_at) {
    return true;
  }

  return Date.parse(task.lease_expires_at) <= Date.now();
}

function hasActiveLease(task: RuntimeTask): boolean {
  return task.status === "in_progress" && !!task.lease_id && !isLeaseExpired(task);
}

function getRunningTasks(state: WorkflowState): RuntimeTask[] {
  return state.tasks.filter(
    (task) => task.status === "in_progress" && !isLeaseExpired(task),
  );
}

async function recoverExpiredLeases(
  state: WorkflowState,
  defaultMaxAttempts: number,
  dryRun: boolean,
): Promise<ExpiredLeaseInfo[]> {
  const expired = state.tasks.filter(isLeaseExpired);

  if (!expired.length) {
    return [];
  }

  const timestamp = new Date().toISOString();

  const recovered: ExpiredLeaseInfo[] = [];

  for (const task of expired) {
    const maxAttempts = task.max_attempts || defaultMaxAttempts;

    recovered.push({
      taskId: task.id,
      attempts: task.attempts,
      maxAttempts,
    });

    if (dryRun) {
      continue;
    }

    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "task_lease_expired",
      task_id: task.id,
      message: `Lease ${task.lease_id ?? "<missing>"} expired.`,
    });

    task.lease_id = null;
    task.lease_expires_at = null;
    task.started_at = null;

    if (task.attempts >= maxAttempts) {
      task.status = "blocked";

      task.last_error =
        `Maximum retry attempts reached after lease expiration ` +
        `(${maxAttempts}).`;

      await appendHistory({
        timestamp,
        workflow_id: state.workflow_id,
        event: "task_status_changed",
        task_id: task.id,
        message:
          `in_progress -> blocked: max attempts reached ` + `(${maxAttempts})`,
      });
    } else {
      task.status = "pending";

      task.last_error = "Previous execution lease expired.";

      await appendHistory({
        timestamp,
        workflow_id: state.workflow_id,
        event: "task_retried",
        task_id: task.id,
        message: "Lease expired; task returned to pending for retry.",
      });
    }
  }

  state.status = deriveWorkflowStatus(state);

  await saveState(state);

  return recovered;
}

function chooseTasks(state: WorkflowState, maxParallel: number): RuntimeTask[] {
  const running = getRunningTasks(state);

  const slots = Math.max(0, maxParallel - running.length);

  if (!slots) {
    return [];
  }

  return findReadyTasks(state.tasks).slice(0, slots);
}

/**
 * Phase 14 — Promote due retry_wait tasks back to pending for one workflow.
 * Thin wrapper over the scheduler-retry persistence logic used by the
 * scheduler entry point.
 */
export function promoteDueRetriesForWorkflow(
  state: WorkflowState,
  options: { persist?: boolean } = {},
): Promise<RuntimeTask[]> {
  return promoteDueRetries(state, new Date(), options);
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * First conflict domain shared by both tasks (case/whitespace-insensitive),
 * or undefined. The candidate's own domain order wins for reporting.
 */
function firstSharedConflictDomain(
  candidate: RuntimeTask,
  leased: RuntimeTask,
): string | undefined {
  const candidateDomains = new Set(
    (candidate.planning?.conflict_domains ?? []).map(normalizeDomain),
  );

  for (const domain of leased.planning?.conflict_domains ?? []) {
    if (candidateDomains.has(normalizeDomain(domain))) {
      return domain.trim();
    }
  }

  return undefined;
}

/**
 * Conflict-domain hold check for one candidate against every actively
 * leased task (plus tasks claimed earlier in the same round). Dependency-
 * ordered pairs are never held.
 */
function findConflictHold(
  candidate: RuntimeTask,
  tasks: RuntimeTask[],
  claimedThisRoundIds: Set<string>,
): ConflictHold | undefined {
  if (!candidate.planning?.conflict_domains?.length) {
    return undefined;
  }

  for (const leased of tasks) {
    if (leased.id === candidate.id) {
      continue;
    }

    const isActiveLease =
      hasActiveLease(leased) || claimedThisRoundIds.has(leased.id);

    if (!isActiveLease) {
      continue;
    }

    if (!areDependencyIndependent(candidate.id, leased.id, tasks)) {
      continue;
    }

    const domain = firstSharedConflictDomain(candidate, leased);

    if (domain !== undefined) {
      return {
        taskId: candidate.id,
        againstTaskId: leased.id,
        domain,
      };
    }
  }

  return undefined;
}

function toRetryWaitingInfo(task: RuntimeTask): RetryWaitingInfo {
  return {
    taskId: task.id,
    agent: task.agent,
    provider: task.last_provider_error?.provider ?? null,
    kind: task.last_provider_error?.kind ?? null,
    retryAt: task.retry_not_before ?? null,
    attempts: task.attempts,
    maxAttempts: task.max_attempts ?? null,
  };
}

function projectedRequestPath(
  workflowId: string,
  requestsDirectory: string,
  taskId: string,
): string {
  return `tasks/${workflowId}/${requestsDirectory}/${taskId}.json`;
}

export type ScheduleOnceOptions = {
  state: WorkflowState;
  dryRun?: boolean;
  teamConfig?: TeamConfig;
  capacity?: ProviderCapacity;
};

/**
 * Run one scheduling round for a workflow.
 *
 * With `dryRun` the round is previewed in memory: leases are recovered on
 * the in-memory state only, retries are promoted without persisting, and
 * no execution request files are written.
 */
export async function scheduleOnce(
  options: ScheduleOnceOptions,
): Promise<ScheduleOnceResult> {
  const dryRun = options.dryRun === true;

  const state = options.state;

  const teamConfig = options.teamConfig ?? (await loadTeamConfig());

  const execution = resolveExecutionConfig(teamConfig);

  const providerName = resolveDefaultProviderName(teamConfig);

  const capacity =
    options.capacity ?? getProviderCapacity(teamConfig, providerName);

  const effectiveParallelism = Math.min(
    execution.max_parallel_agents,
    capacity.maxConcurrency,
  );

  if (state.status === "completed" || state.status === "cancelled") {
    throw new Error(
      `Workflow "${state.workflow_id}" cannot be scheduled (${state.status}).`,
    );
  }

  const expiredLeases = await recoverExpiredLeases(
    state,
    execution.max_attempts,
    dryRun,
  );

  const refreshed = dryRun ? state : await loadState(state.workflow_id);

  // Promote due retry_wait tasks back to pending so the normal
  // ready-task pipeline can claim them. Persisted timestamps make this
  // safe across process restarts. Dry-run previews in memory only.
  await promoteDueRetriesForWorkflow(refreshed, { persist: !dryRun });

  const lines: string[] = [];

  if (expiredLeases.length) {
    lines.push(`Recovered ${expiredLeases.length} expired lease(s).`);
  }

  if (refreshed.status === "blocked") {
    return {
      workflowId: refreshed.workflow_id,
      blocked: true,
      providerName,
      providerMaxConcurrency: capacity.maxConcurrency,
      teamMaxParallel: execution.max_parallel_agents,
      effectiveParallelism,
      leaseMinutes: execution.lease_minutes,
      maxAttempts: execution.max_attempts,
      expiredLeases,
      waitingRetries: [],
      routingDecisions: [],
      claims: [],
      skippedByCapability: [],
      conflictHolds: [],
      lines,
    };
  }

  const waitingRetries = findWaitingRetryTasks(refreshed.tasks).map(
    toRetryWaitingInfo,
  );

  const readyTasks = chooseTasks(refreshed, effectiveParallelism);

  const routed = routeReadyTasks(readyTasks, refreshed, teamConfig);

  const selected = routed.map((item) => item.task);

  if (!dryRun) {
    // Persist routed concrete agent before requests are generated.
    await saveState(refreshed);

    for (const item of routed) {
      if (!item.routingDecision) {
        continue;
      }

      await appendHistory({
        timestamp: new Date().toISOString(),
        workflow_id: refreshed.workflow_id,
        event: "task_status_changed",
        task_id: item.task.id,
        message:
          `capability routing: ` +
          `${item.routingDecision.previousAgent} -> ` +
          `${item.routingDecision.selectedAgent}; ` +
          `required=[${item.routingDecision.requiredCapabilities.join(", ")}]`,
      });
    }
  }

  const timestamp = new Date().toISOString();

  const previousWorkflowStatus = refreshed.status;

  const claims: ClaimedTask[] = [];

  const conflictHolds: ConflictHold[] = [];

  // Reserved for future capability-based skipping; no behavior change yet.
  const skippedByCapability: SkippedByCapability[] = [];

  const claimedThisRoundIds = new Set<string>();

  for (const selectedTask of selected) {
    const task = refreshed.tasks.find((item) => item.id === selectedTask.id);

    if (!task || task.status !== "pending") {
      throw new Error(
        `Task "${selectedTask.id}" changed before scheduler claim.`,
      );
    }

    // Conflict-domain hold: dependency-independent candidates sharing a
    // conflict domain with an actively leased task wait for the next
    // round. Advisory only — no state mutation, no history event.
    const hold = findConflictHold(task, refreshed.tasks, claimedThisRoundIds);

    if (hold) {
      conflictHolds.push(hold);

      lines.push(
        `Conflict hold: ${hold.taskId} held by ${hold.againstTaskId} ` +
          `(domain: ${hold.domain}).`,
      );

      continue;
    }

    task.max_attempts ||= execution.max_attempts;

    if (task.attempts >= task.max_attempts) {
      task.status = "blocked";

      task.last_error = `Maximum attempts reached ` + `(${task.max_attempts}).`;

      continue;
    }

    task.status = "in_progress";

    task.started_at = timestamp;

    task.completed_at = null;

    task.attempts += 1;

    task.last_error = null;

    task.lease_id = randomUUID();

    task.lease_expires_at = leaseExpiration(execution.lease_minutes);

    claimedThisRoundIds.add(task.id);

    if (dryRun) {
      claims.push({
        taskId: task.id,
        agent: task.agent,
        title: task.title,
        requestFile: projectedRequestPath(
          refreshed.workflow_id,
          execution.requests_directory,
          task.id,
        ),
      });

      continue;
    }

    await appendHistory({
      timestamp,
      workflow_id: refreshed.workflow_id,
      event: "task_claimed",
      task_id: task.id,
      message:
        `Task claimed with lease ${task.lease_id}; ` +
        `attempt ${task.attempts}/${task.max_attempts}.`,
    });

    const requestFile = await writeExecutionRequest(
      refreshed,
      task,
      teamConfig,
      execution.requests_directory,
      providerName,
    );

    claims.push({
      taskId: task.id,
      agent: task.agent,
      title: task.title,
      requestFile,
    });
  }

  if (conflictHolds.length) {
    lines.push(`Held ${conflictHolds.length} task(s) by conflict domain.`);
  }

  refreshed.status = deriveWorkflowStatus(refreshed);

  if (!dryRun) {
    await saveState(refreshed);

    if (previousWorkflowStatus !== refreshed.status) {
      await appendHistory({
        timestamp,
        workflow_id: refreshed.workflow_id,
        event: "workflow_status_changed",
        message: `${previousWorkflowStatus} -> ${refreshed.status}`,
      });
    }
  }

  return {
    workflowId: refreshed.workflow_id,
    blocked: false,
    providerName,
    providerMaxConcurrency: capacity.maxConcurrency,
    teamMaxParallel: execution.max_parallel_agents,
    effectiveParallelism,
    leaseMinutes: execution.lease_minutes,
    maxAttempts: execution.max_attempts,
    expiredLeases,
    waitingRetries,
    routingDecisions: routed
      .map((item) => item.routingDecision)
      .filter((decision): decision is RoutingDecision => Boolean(decision)),
    claims,
    skippedByCapability,
    conflictHolds,
    lines,
  };
}
