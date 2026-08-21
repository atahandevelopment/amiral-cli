/**
 * Phase 13 — Scheduler-side retry support.
 *
 * Retry scheduling is persisted in workflow state (`retry_wait` +
 * `retry_not_before`). These helpers let the scheduler:
 *
 *   - list tasks whose retry time is still in the future (display only)
 *   - promote due retries back to "pending" so the existing
 *     findReadyTasks pipeline picks them up unchanged
 *
 * No timers: correctness relies purely on persisted timestamps compared
 * against the current clock, so process restarts are harmless.
 */

import type { RuntimeTask, WorkflowState } from "./types.js";
import { appendHistory, saveState } from "./workflow-store.js";

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Tasks in "retry_wait" whose retry_not_before is still in the future.
 */
export function findWaitingRetryTasks(
  tasks: RuntimeTask[],
  now: Date = new Date(),
): RuntimeTask[] {
  const nowMs = now.getTime();

  return tasks.filter((task) => {
    if (task.status !== "retry_wait") {
      return false;
    }

    const notBefore = parseTimestamp(task.retry_not_before);

    // A missing/invalid timestamp must never wedge a task forever:
    // treat it as immediately eligible.
    return notBefore !== null && notBefore > nowMs;
  });
}

/**
 * Tasks in "retry_wait" that are eligible to run again right now.
 */
export function findDueRetryTasks(
  tasks: RuntimeTask[],
  now: Date = new Date(),
): RuntimeTask[] {
  const nowMs = now.getTime();

  return tasks.filter((task) => {
    if (task.status !== "retry_wait") {
      return false;
    }

    const notBefore = parseTimestamp(task.retry_not_before);

    return notBefore === null || notBefore <= nowMs;
  });
}

/**
 * Promote all due retry_wait tasks back to "pending", persisting state and
 * history so the normal scheduler pipeline can claim them. Returns the
 * promoted tasks.
 *
 * With `persist: false` the transition is applied in memory only — used by
 * dry-run scheduling to preview what would be selected.
 */
export async function promoteDueRetries(
  state: WorkflowState,
  now: Date = new Date(),
  options: { persist?: boolean } = {},
): Promise<RuntimeTask[]> {
  const due = findDueRetryTasks(state.tasks, now);

  if (!due.length) {
    return [];
  }

  const persist = options.persist !== false;

  for (const task of due) {
    task.status = "pending";
    task.retry_not_before = null;

    if (!persist) {
      continue;
    }

    await appendHistory({
      timestamp: now.toISOString(),
      workflow_id: state.workflow_id,
      event: "task_retried",
      task_id: task.id,
      message: "Retry window elapsed; task returned to pending.",
      details: {
        provider: task.last_provider_error?.provider,
        kind: task.last_provider_error?.kind,
      },
    });
  }

  if (persist) {
    await saveState(state);
  }

  return due;
}
