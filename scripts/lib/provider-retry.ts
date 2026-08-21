/**
 * Phase 13 — Retry state transitions for provider failures.
 *
 * Chosen retry model (documented in PHASE13_RESILIENCE_PROVIDER_ABSTRACTION.md):
 *
 *   Task attempt    = one scheduler claim / execution lease lifecycle.
 *   Provider retry  = PERSISTED, not in-process. A transient provider error
 *                     releases the lease, moves the task to "retry_wait"
 *                     with a persisted `retry_not_before` timestamp, and the
 *                     scheduler reclaims the task later. The attempt counter
 *                     only advances when the scheduler claims again, so
 *                     retries survive process restarts and can never spin
 *                     inside the dispatcher.
 *
 * No blocking sleeps are performed anywhere in this module.
 */

import type { ExecutionRequest } from "./execution-request.js";
import type {
  LastProviderError,
  RuntimeTask,
  WorkflowState,
} from "./types.js";
import type { TeamProviderConfig } from "./team-config.js";
import { appendHistory, deriveWorkflowStatus, loadState, saveState } from "./workflow-store.js";
import { ProviderError } from "./providers/provider-error.js";
import { calculateRetryDelay, isRetryBudgetExhausted } from "./providers/retry-policy.js";

export type ProviderRetryOutcome =
  | {
      outcome: "retry_wait";
      retryNotBefore: string;
      delayMs: number;
      attempt: number;
      maxAttempts: number;
    }
  | {
      outcome: "blocked";
      attempt: number;
      maxAttempts: number;
    };

export type ProviderPermanentOutcome = {
  outcome: "failed";
};

export type ProviderFailureOutcome =
  | ProviderRetryOutcome
  | ProviderPermanentOutcome;

function buildLastProviderError(
  error: ProviderError,
): LastProviderError {
  return {
    provider: error.provider,
    kind: error.kind,
    message: error.message.slice(0, 2000),
    retryable: error.retryable,
    ...(error.statusCode !== undefined
      ? { status_code: error.statusCode }
      : {}),
  };
}

async function loadTaskForRequest(
  request: ExecutionRequest,
): Promise<{ state: WorkflowState; task: RuntimeTask }> {
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
      `Cannot apply provider failure for "${task.id}": lease mismatch.`,
    );
  }

  return { state, task };
}

/**
 * Handle a transient (retryable) ProviderError for a claimed task.
 *
 * - Budget remaining  → task becomes "retry_wait", lease released,
 *                       retry_not_before persisted.
 * - Budget exhausted  → task becomes "blocked".
 */
export async function applyProviderRetry(options: {
  request: ExecutionRequest;
  error: ProviderError;
  retryConfig: TeamProviderConfig["retry"];
}): Promise<ProviderRetryOutcome> {
  const { request, error, retryConfig } = options;

  const { state, task } = await loadTaskForRequest(request);

  const maxAttempts = task.max_attempts ?? retryConfig.max_attempts;
  const previousWorkflowStatus = state.status;
  const timestamp = new Date().toISOString();

  // Release the lease first: no matter which branch runs below, this
  // attempt lifecycle is over.
  task.lease_id = null;
  task.lease_expires_at = null;
  task.started_at = null;
  task.last_provider_error = buildLastProviderError(error);

  if (isRetryBudgetExhausted(task.attempts, maxAttempts)) {
    task.status = "blocked";
    task.completed_at = null;
    task.retry_not_before = null;
    task.last_error =
      `Transient provider failure (${error.kind}) exhausted the retry budget ` +
      `(${task.attempts}/${maxAttempts}).`;

    state.status = deriveWorkflowStatus(state);
    await saveState(state);

    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "provider_failure",
      task_id: task.id,
      message:
        `Provider "${error.provider}" transient failure (${error.kind}) ` +
        `exhausted retry budget; task blocked.`,
      details: {
        provider: error.provider,
        kind: error.kind,
        retryable: true,
        attempt: task.attempts,
        max_attempts: maxAttempts,
      },
    });

    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "task_status_changed",
      task_id: task.id,
      message: `in_progress -> blocked (retry budget exhausted)`,
    });

    if (previousWorkflowStatus !== state.status) {
      await appendHistory({
        timestamp,
        workflow_id: state.workflow_id,
        event: "workflow_status_changed",
        message: `${previousWorkflowStatus} -> ${state.status}`,
      });
    }

    return { outcome: "blocked", attempt: task.attempts, maxAttempts };
  }

  const delayMs = calculateRetryDelay({
    attempt: task.attempts,
    baseDelayMs: retryConfig.base_delay_ms,
    maxDelayMs: retryConfig.max_delay_ms,
    retryAfterMs: error.retryAfterMs,
    jitter: retryConfig.jitter,
  });

  const retryNotBefore = new Date(Date.now() + delayMs).toISOString();

  task.status = "retry_wait";
  task.completed_at = null;
  task.retry_not_before = retryNotBefore;
  task.last_error =
    `Transient provider failure (${error.kind}); retry scheduled.`;

  state.status = deriveWorkflowStatus(state);
  await saveState(state);

  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "provider_retry_scheduled",
    task_id: task.id,
    message:
      `Provider "${error.provider}" transient failure (${error.kind}); ` +
      `retry ${task.attempts}/${maxAttempts} scheduled at ${retryNotBefore}.`,
    details: {
      provider: error.provider,
      kind: error.kind,
      retryable: true,
      attempt: task.attempts,
      max_attempts: maxAttempts,
      next_retry_at: retryNotBefore,
      delay_ms: delayMs,
      ...(error.statusCode !== undefined
        ? { status_code: error.statusCode }
        : {}),
    },
  });

  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "task_status_changed",
    task_id: task.id,
    message: `in_progress -> retry_wait (retry at ${retryNotBefore})`,
  });

  if (previousWorkflowStatus !== state.status) {
    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "workflow_status_changed",
      message: `${previousWorkflowStatus} -> ${state.status}`,
    });
  }

  return {
    outcome: "retry_wait",
    retryNotBefore,
    delayMs,
    attempt: task.attempts,
    maxAttempts,
  };
}

/**
 * Handle a non-retryable ProviderError for a claimed task: the task fails
 * immediately with a structured diagnostic. The worktree is NOT touched so
 * partial changes and diagnostics are preserved.
 */
export async function applyPermanentProviderFailure(options: {
  request: ExecutionRequest;
  error: ProviderError;
}): Promise<ProviderPermanentOutcome> {
  const { request, error } = options;

  const { state, task } = await loadTaskForRequest(request);

  const previousWorkflowStatus = state.status;
  const timestamp = new Date().toISOString();

  task.lease_id = null;
  task.lease_expires_at = null;
  task.started_at = null;
  task.status = "failed";
  task.completed_at = null;
  task.retry_not_before = null;
  task.last_provider_error = buildLastProviderError(error);
  task.last_error =
    `Permanent provider failure (${error.kind}, retryable: no): ` +
    `${error.message.slice(0, 500)}`;

  state.status = deriveWorkflowStatus(state);
  await saveState(state);

  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "provider_failure",
    task_id: task.id,
    message:
      `Provider "${error.provider}" permanent failure (${error.kind}); ` +
      `task failed without retry.`,
    details: {
      provider: error.provider,
      kind: error.kind,
      retryable: false,
      attempt: task.attempts,
      ...(error.statusCode !== undefined
        ? { status_code: error.statusCode }
        : {}),
    },
  });

  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "task_status_changed",
    task_id: task.id,
    message: `in_progress -> failed (permanent provider failure: ${error.kind})`,
  });

  if (previousWorkflowStatus !== state.status) {
    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "workflow_status_changed",
      message: `${previousWorkflowStatus} -> ${state.status}`,
    });
  }

  return { outcome: "failed" };
}

/**
 * When a task that previously suffered a provider failure finally completes,
 * record the recovery and clear the stale diagnostic. Called from the
 * result-application paths.
 */
export async function maybeRecordProviderRecovery(
  state: WorkflowState,
  task: RuntimeTask,
): Promise<boolean> {
  if (!task.last_provider_error) {
    return false;
  }

  const previousProvider = task.last_provider_error.provider;

  task.last_provider_error = null;
  task.retry_not_before = null;

  await appendHistory({
    timestamp: new Date().toISOString(),
    workflow_id: state.workflow_id,
    event: "provider_recovered",
    task_id: task.id,
    message: `Task completed after earlier provider failure; recovery recorded.`,
    details: {
      provider: previousProvider,
    },
  });

  return true;
}
