/**
 * Phase 14 STAGE 1b — Workflow administration service.
 *
 * Pure-data views and mutations over workflow state, shared by the future
 * CLI commands (`amiral status`, `amiral list`, `amiral use`, `amiral show`,
 * `amiral history`, `amiral cancel`, `amiral retry`):
 *
 *   - views return plain serializable objects; rendering is the CLI's job
 *   - mutations persist state + history exactly like the orchestration
 *     services do (no console output, no process exits)
 *   - refusal cases (e.g. cancelling a completed workflow without --force)
 *     throw AdminError so the CLI can map them to a friendly exit code
 *
 * Task worktrees are NEVER touched here: retries only reset state fields.
 */

import { readdir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  HistoryEvent,
  RuntimeTask,
  TaskStatus,
  WorkflowState,
} from "./types.js";
import type { TeamConfig } from "./team-config.js";
import {
  loadTeamConfig,
  resolveDefaultProviderName,
} from "./team-config.js";

import {
  ACTIVE_WORKFLOW_FILE,
  appendHistory,
  deriveWorkflowStatus,
  getActiveWorkflowId,
  graphFile,
  listWorkflowIds,
  loadHistory,
  loadJson,
  loadState,
  resolveWorkflowId,
  saveState,
  setActiveWorkflowId,
  stateFile,
  workflowExists,
} from "./workflow-store.js";

import { sanitizeSegment } from "./git-worktree.js";

export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminError";
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a workflow or refuse with AdminError (never a raw filesystem error).
 */
async function requireState(workflowId?: string): Promise<WorkflowState> {
  try {
    return await loadState(workflowId);
  } catch (error) {
    throw new AdminError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type StatusCounts = {
  completed: number;
  running: number;
  pending: number;
  retry_wait: number;
  failed: number;
  blocked: number;
  cancelled: number;
};

export type StatusTaskView = {
  id: string;
  agent: string;
  status: TaskStatus;
  retryNotBefore?: string | null;
  lastProviderErrorKind?: string | null;
};

export type StatusView = {
  workflowId: string;
  name: string;
  workflowType: WorkflowState["workflow_type"];
  status: WorkflowState["status"];
  provider: string;
  counts: StatusCounts;
  tasks: StatusTaskView[];
  /** Number of task worktree directories for this workflow. */
  activeWorktrees: number;
};

/**
 * Derive the human workflow name from the generated id convention
 * `<name>-<8 hex chars>` created by createWorkflowFromGraph. Falls back to
 * the raw id when the pattern does not match.
 */
function deriveWorkflowName(workflowId: string): string {
  const match = /^(.*)-[0-9a-f]{8}$/.exec(workflowId);

  return match?.[1] || workflowId;
}

/**
 * Cheap worktree usage count: number of entries under
 * .amiral/worktrees/<workflowId>/ when present.
 */
export async function countActiveWorktrees(
  workflowId: string,
): Promise<number> {
  const dir = resolve(
    process.cwd(),
    ".amiral",
    "worktrees",
    sanitizeSegment(workflowId),
  );

  if (!(await pathExists(dir))) {
    return 0;
  }

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

const EMPTY_COUNTS: StatusCounts = {
  completed: 0,
  running: 0,
  pending: 0,
  retry_wait: 0,
  failed: 0,
  blocked: 0,
  cancelled: 0,
};

export async function getStatusView(
  state: WorkflowState,
  teamConfig?: TeamConfig,
): Promise<StatusView> {
  const config = teamConfig ?? (await loadTeamConfig());

  const counts: StatusCounts = { ...EMPTY_COUNTS };

  for (const task of state.tasks) {
    switch (task.status) {
      case "in_progress":
        counts.running += 1;
        break;
      case "retry_wait":
        counts.retry_wait += 1;
        break;
      default:
        counts[task.status] += 1;
        break;
    }
  }

  const tasks: StatusTaskView[] = state.tasks.map((task) => ({
    id: task.id,
    agent: task.agent,
    status: task.status,
    ...(task.retry_not_before
      ? { retryNotBefore: task.retry_not_before }
      : {}),
    ...(task.last_provider_error
      ? { lastProviderErrorKind: task.last_provider_error.kind }
      : {}),
  }));

  return {
    workflowId: state.workflow_id,
    name: deriveWorkflowName(state.workflow_id),
    workflowType: state.workflow_type,
    status: state.status,
    provider: resolveDefaultProviderName(config),
    counts,
    tasks,
    activeWorktrees: await countActiveWorktrees(state.workflow_id),
  };
}

export type WorkflowListItem = {
  id: string;
  status: WorkflowState["status"] | "unknown";
  active: boolean;
  updatedAt: string | null;
};

/** All workflows on disk with their status and the active pointer flag. */
export async function listWorkflowsView(): Promise<WorkflowListItem[]> {
  const ids = await listWorkflowIds();

  const activeId = await getActiveWorkflowId();

  const items: WorkflowListItem[] = [];

  for (const id of ids) {
    let status: WorkflowListItem["status"] = "unknown";
    let updatedAt: string | null = null;

    try {
      const state = await loadJson<WorkflowState>(stateFile(id));

      status = state.status;
      updatedAt = state.updated_at ?? null;
    } catch {
      // Unreadable state file: report as unknown instead of failing.
    }

    items.push({
      id,
      status,
      active: activeId === id,
      updatedAt,
    });
  }

  return items.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Point the active-workflow pointer at `id`. Refuses unknown workflows.
 */
export async function useWorkflow(id: string): Promise<string> {
  if (!(await workflowExists(id))) {
    throw new AdminError(`Workflow "${id}" does not exist or is invalid.`);
  }

  await setActiveWorkflowId(id);

  return id;
}

export type ShowTaskView = {
  id: string;
  title: string;
  agent: string;
  description: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  status: TaskStatus;
  attempts: number;
  maxAttempts?: number;
  startedAt: string | null;
  completedAt: string | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  retryNotBefore: string | null;
  resultFile: string | null;
};

export type ShowWorkflowView = {
  workflowId: string;
  name: string;
  workflowType: WorkflowState["workflow_type"];
  status: WorkflowState["status"];
  createdAt: string;
  updatedAt: string;
  sourceGraph: string;
  /** Optional planner goal/summary when present in the graph file. */
  goal?: string;
  summary?: string;
  tasks: ShowTaskView[];
};

/** Full detail view for one workflow, including graph goal/summary. */
export async function showWorkflowView(
  id?: string,
): Promise<ShowWorkflowView> {
  const state = await requireState(id);

  type GraphFileShape = {
    goal?: unknown;
    summary?: unknown;
  };

  let goal: string | undefined;
  let summaryText: string | undefined;

  try {
    const graph = await loadJson<GraphFileShape>(
      graphFile(state.workflow_id),
    );

    if (typeof graph.goal === "string") goal = graph.goal;
    if (typeof graph.summary === "string") summaryText = graph.summary;
  } catch {
    // Graph file optional for the view.
  }

  const tasks: ShowTaskView[] = state.tasks.map((task: RuntimeTask) => ({
    id: task.id,
    title: task.title,
    agent: task.agent,
    description: task.description,
    dependencies: [...task.dependencies],
    acceptanceCriteria: [...task.acceptance_criteria],
    status: task.status,
    attempts: task.attempts,
    ...(task.max_attempts ? { maxAttempts: task.max_attempts } : {}),
    startedAt: task.started_at ?? null,
    completedAt: task.completed_at ?? null,
    leaseId: task.lease_id ?? null,
    leaseExpiresAt: task.lease_expires_at ?? null,
    lastError: task.last_error ?? null,
    retryNotBefore: task.retry_not_before ?? null,
    resultFile: task.result_file ?? null,
  }));

  return {
    workflowId: state.workflow_id,
    name: deriveWorkflowName(state.workflow_id),
    workflowType: state.workflow_type,
    status: state.status,
    createdAt: state.created_at,
    updatedAt: state.updated_at,
    sourceGraph: state.source_graph,
    ...(goal ? { goal } : {}),
    ...(summaryText ? { summary: summaryText } : {}),
    tasks,
  };
}

/** Recent history events, newest first. */
export async function historyView(
  id?: string,
  limit = 20,
): Promise<HistoryEvent[]> {
  const workflowId = await resolveWorkflowId(id);

  const events = await loadHistory(workflowId);

  const bounded =
    Number.isInteger(limit) && limit > 0 ? limit : 20;

  return events.slice(-bounded).reverse();
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Cancel a workflow.
 *
 * Refuses completed workflows unless force is set. All leases are released
 * and every task keeps its terminal/intermediate status; only the workflow
 * itself is marked cancelled. The active pointer is cleared when it pointed
 * at this workflow.
 */
export async function cancelWorkflow(
  id: string,
  options: { force?: boolean } = {},
): Promise<{ workflowId: string; releasedLeases: number }> {
  const state = await requireState(id);

  if (state.status === "completed" && options.force !== true) {
    throw new AdminError(
      `Workflow "${state.workflow_id}" is already completed. ` +
        `Use force to cancel it anyway.`,
    );
  }

  if (state.status === "cancelled") {
    return { workflowId: state.workflow_id, releasedLeases: 0 };
  }

  const timestamp = new Date().toISOString();

  let releasedLeases = 0;

  for (const task of state.tasks) {
    if (task.lease_id || task.started_at) {
      releasedLeases += 1;
    }

    task.lease_id = null;
    task.lease_expires_at = null;
    task.started_at = null;
  }

  state.status = "cancelled";
  await saveState(state);

  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "workflow_cancelled",
    message: `Workflow cancelled by operator (${releasedLeases} lease(s) released).`,
  });

  const activeId = await getActiveWorkflowId();

  if (activeId === state.workflow_id) {
    try {
      await unlink(ACTIVE_WORKFLOW_FILE);
    } catch {
      // Best effort: a stale pointer file resolves to no active workflow.
    }
  }

  return { workflowId: state.workflow_id, releasedLeases };
}

/**
 * Reset one task for a manual retry.
 *
 * Allowed source states are failed | blocked | retry_wait. Completed tasks
 * require force. Any other non-terminal state requires force as well —
 * resetting an in-progress or pending task would silently discard live
 * scheduling information otherwise.
 *
 * Clears error diagnostics, provider errors, retry timers and lease fields,
 * resets the attempt counter, and moves the task back to pending. The task
 * worktree is intentionally left untouched so prior partial changes and
 * diagnostics survive.
 */
export async function manualRetryTask(
  taskId: string,
  options: { force?: boolean; workflowId?: string } = {},
): Promise<{ workflowId: string; taskId: string }> {
  const state = await requireState(options.workflowId);

  const task = state.tasks.find((item) => item.id === taskId);

  if (!task) {
    throw new AdminError(
      `Task "${taskId}" does not exist in workflow "${state.workflow_id}".`,
    );
  }

  const allowed: TaskStatus[] = ["failed", "blocked", "retry_wait"];
  const previousStatus = task.status;

  if (!allowed.includes(previousStatus)) {
    if (options.force !== true) {
      const hint =
        task.status === "completed"
          ? "Completed tasks require force to retry."
          : `Tasks in status "${task.status}" require force to retry.`;

      throw new AdminError(
        `Cannot retry task "${task.id}" from status "${task.status}". ${hint}`,
      );
    }
  }

  resetTaskForRetry(task);

  const previousWorkflowStatus = state.status;
  state.status = deriveWorkflowStatus(state);

  await saveState(state);

  const timestamp = new Date().toISOString();
  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "task_retried",
    task_id: task.id,
    message: "manual retry requested",
    details: { previous_status: previousStatus, forced: options.force === true },
  });
  await recordWorkflowStatusChange(state, previousWorkflowStatus, timestamp);

  return { workflowId: state.workflow_id, taskId: task.id };
}

function resetTaskForRetry(task: RuntimeTask): void {
  task.last_error = null;
  task.last_provider_error = null;
  task.retry_not_before = null;
  task.lease_id = null;
  task.lease_expires_at = null;
  task.started_at = null;
  task.completed_at = null;
  task.attempts = 0;
  task.status = "pending";
}

async function recordWorkflowStatusChange(state: WorkflowState, previous: WorkflowState["status"], timestamp: string): Promise<void> {
  if (previous === state.status) return;
  await appendHistory({ timestamp, workflow_id: state.workflow_id, event: "workflow_status_changed", message: `${previous} -> ${state.status}` });
}

/**
 * Apply manualRetryTask to every task matching the scope ("failed" or
 * "blocked") and return the retried ids in state order.
 */
export async function retryByScope(
  scope: "failed" | "blocked",
  options: { workflowId?: string } = {},
): Promise<string[]> {
  const state = await requireState(options.workflowId);

  const targets = state.tasks
    .filter((task) => task.status === scope)
    .map((task) => task.id);

  const timestamp = new Date().toISOString();
  const previousWorkflowStatus = state.status;
  for (const task of state.tasks.filter((item) => item.status === scope)) resetTaskForRetry(task);
  state.status = deriveWorkflowStatus(state);
  await saveState(state);
  for (const taskId of targets) await appendHistory({ timestamp, workflow_id: state.workflow_id, event: "task_retried", task_id: taskId, message: "manual retry requested", details: { previous_status: scope, forced: false } });
  await recordWorkflowStatusChange(state, previousWorkflowStatus, timestamp);
  return targets;
}
