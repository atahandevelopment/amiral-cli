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

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { RuntimeTask, WorkflowState } from "./types.js";
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
  resolveProjectUiConfig,
} from "./team-config.js";
import {
  VisualQAService,
  visualQAProviders,
  type DesignSpec,
  type VisualQAResult,
} from "./visual-qa.js";
import { writeJson } from "./workflow-store.js";
import { validateContract } from "./contract-validator.js";

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
  /** Test/adapter seam; normal runs use the process-wide provider registry. */
  visualQAService?: Pick<VisualQAService, "evaluate">;
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
): Promise<Awaited<ReturnType<typeof createIntegrationWorkspace>>> {
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
  return workspace;
}

type VisualQAPhase = { fixesCreated: boolean; blocking?: boolean; result?: VisualQAResult; iteration?: number };

async function findDesignSpec(state: WorkflowState): Promise<{ spec: DesignSpec; ref: string } | undefined> {
  const refs = state.tasks.flatMap(task => task.artifact_refs ?? []).filter(ref => ref.endsWith("uiux-design-spec.json"));
  const sourceCandidate = resolve(dirname(state.source_graph), "uiux-design-spec.json");
  const candidates = [...new Set([...refs.map(ref => resolveApprovedDesignArtifact(ref, state)), sourceCandidate])];
  for (const file of candidates) {
    try {
      const spec = JSON.parse(await readFile(file, "utf8")) as DesignSpec;
      await validateContract("design-spec", spec);
      return { spec, ref: file };
    } catch { /* unavailable or invalid candidates are never consumed */ }
  }
  return undefined;
}

function resolveApprovedDesignArtifact(ref: string, state: WorkflowState): string {
  if (ref.includes("\0")) throw new Error("Design artifact reference contains invalid characters.");
  const root = resolve(process.cwd());
  const candidate = resolve(root, ref);
  const planRoot = resolve(root, "plans");
  const graphRoot = resolve(dirname(state.source_graph));
  const inside = (base: string): boolean => candidate === base || candidate.startsWith(`${base}\\`) || candidate.startsWith(`${base}/`);
  const legacy = candidate === resolve(root, "uiux-design-spec.json");
  if (!legacy && !inside(planRoot) && !inside(graphRoot)) throw new Error(`Design artifact reference is outside approved roots: ${ref}`);
  return candidate;
}

async function visualIteration(gatesDir: string): Promise<number> {
  try {
    const files = await readdir(gatesDir);
    return files.filter(name => /^visual-qa-iteration-\d+\.json$/.test(name)).length + 1;
  } catch { return 1; }
}

async function runVisualQAPhase(
  state: WorkflowState,
  workspace: Awaited<ReturnType<typeof createIntegrationWorkspace>>,
  teamConfig: Awaited<ReturnType<typeof loadTeamConfig>>,
  service: Pick<VisualQAService, "evaluate">,
  onEvent: (line: string) => void,
): Promise<VisualQAPhase> {
  const ui = resolveProjectUiConfig(teamConfig);
  if (!ui.enabled) return { fixesCreated: false }; // Preserve non-UI behavior completely.
  const gatesDir = resolve(workspace.worktreePath, ".amiral", "gates");
  const iteration = await visualIteration(gatesDir);
  if (iteration > ui.visual_qa.max_iterations) {
    try {
      const prior = JSON.parse(await readFile(resolve(gatesDir, "visual-qa-result.json"), "utf8")) as VisualQAResult;
      onEvent(`[visual-qa] iteration budget exhausted; ${prior.residual_findings} finding(s) remain in .amiral/gates/visual-qa-result.json`);
      return { fixesCreated: false, blocking: isBlockingVisualResult(prior), result: prior, iteration: iteration - 1 };
    } catch { /* recover by producing a fresh diagnostic */ }
  }
  const design = await findDesignSpec(state);
  let result: VisualQAResult;
  if (!ui.visual_qa.enabled) {
    result = { status: "BLOCKED", outcome_code: "disabled", summary: "Visual QA skipped: disabled by normalized configuration.", findings: [], startup_gate: { status: "BLOCKED", summary: "Visual QA is disabled." }, residual_findings: 0 };
  } else if (!design) {
    result = { status: "BLOCKED", outcome_code: "artifact_unavailable", summary: "Visual QA skipped: design specification artifact is unavailable.", findings: [], startup_gate: { status: "BLOCKED", summary: "Design artifact unavailable." }, residual_findings: 0 };
  } else if (!ui.server.ready_url) {
    result = { status: "BLOCKED", outcome_code: "startup_failed", summary: "Visual QA cannot start: ui.server.ready_url is not configured.", findings: [], startup_gate: { status: "FAIL", summary: "Ready URL is not configured." }, residual_findings: 0 };
  } else {
    result = await service.evaluate({ enabled: true, provider: ui.visual_qa.provider, allowedHosts: ui.allowed_hosts, routes: ui.routes, server: { cwd: workspace.worktreePath, readyUrl: ui.server.ready_url, startCommand: ui.server.start_command, startupTimeoutMs: ui.server.startup_timeout_ms, shutdownTimeoutMs: ui.server.shutdown_timeout_ms }, designSpec: design.spec, viewports: ui.visual_qa.viewports });
  }
  await writeJson(resolve(gatesDir, `visual-qa-iteration-${iteration}.json`), result);
  await writeJson(resolve(gatesDir, "visual-qa-result.json"), result);
  const outcomeCode = result.outcome_code ?? legacyOutcomeCode(result);
  result = { ...result, outcome_code: outcomeCode };
  const skipped = outcomeCode === "disabled" || outcomeCode === "provider_unavailable" || outcomeCode === "artifact_unavailable";
  await appendHistory({ timestamp: new Date().toISOString(), workflow_id: state.workflow_id, event: skipped ? "visual_qa_skipped" : "visual_qa_completed", message: `Visual QA iteration ${iteration}: ${result.status} — ${result.summary}`, details: { iteration, residual_findings: result.residual_findings, artifact: `.amiral/gates/visual-qa-result.json` } });
  onEvent(`[visual-qa] iteration ${iteration}: ${result.status} — ${result.summary} (residual=${result.residual_findings})`);

  const actionable = result.findings.filter(finding => finding.severity === "critical" || finding.severity === "high");
  if (skipped || actionable.length === 0 || iteration >= ui.visual_qa.max_iterations || result.status === "BLOCKED") {
    if (actionable.length && iteration >= ui.visual_qa.max_iterations) onEvent(`[visual-qa] maximum iterations reached; ${result.residual_findings} finding(s) remain in .amiral/gates/visual-qa-result.json`);
    return { fixesCreated: false, blocking: !skipped && (result.status === "BLOCKED" || (iteration >= ui.visual_qa.max_iterations && actionable.length > 0)), result, iteration };
  }
  const persisted = await loadState(state.workflow_id);
  const completedDependencies = persisted.tasks.filter(task => task.agent === "frontend" && task.status === "completed").map(task => task.id);
  const designRef = design?.ref ?? "uiux-design-spec.json";
  const findingsRef = `.amiral/gates/visual-qa-iteration-${iteration}.json`;
  const created: RuntimeTask[] = actionable.map((finding, index) => ({
    id: `FIX-VQA-R${iteration}-${String(index + 1).padStart(3, "0")}`,
    title: `Fix Visual QA ${finding.severity} finding`, agent: "frontend",
    description: `Resolve the targeted Visual QA finding: ${finding.message}${finding.route ? ` Route: ${finding.route}.` : ""}`,
    dependencies: completedDependencies, acceptance_criteria: [`The referenced ${finding.severity} finding is resolved without UI regressions.`],
    artifact_refs: [designRef, findingsRef], status: "pending", attempts: 0, started_at: null, completed_at: null, last_error: null, result_file: null,
  }));
  persisted.tasks.push(...created);
  persisted.status = "running";
  await saveState(persisted);
  await appendHistory({ timestamp: new Date().toISOString(), workflow_id: state.workflow_id, event: "visual_qa_fixes_created", message: `Visual QA iteration ${iteration} created ${created.map(task => task.id).join(", ")}.`, details: { iteration, task_ids: created.map(task => task.id), findings_artifact: findingsRef, design_artifact: designRef } });
  onEvent(`[visual-qa] created targeted frontend fixes: ${created.map(task => task.id).join(", ")}`);
  return { fixesCreated: true, result, iteration };
}

function hasSevereVisualFindings(result: VisualQAResult): boolean {
  return result.findings.some(finding => finding.severity === "critical" || finding.severity === "high");
}

function legacyOutcomeCode(result: VisualQAResult): NonNullable<VisualQAResult["outcome_code"]> {
  if (result.status === "PASS") return "passed";
  if (result.status === "FAIL") return "findings";
  // Legacy BLOCKED artifacts had no structured reason. Fail closed on resume.
  return "provider_failed";
}

function isBlockingVisualResult(result: VisualQAResult): boolean {
  const code = result.outcome_code ?? legacyOutcomeCode(result);
  if (code === "disabled" || code === "provider_unavailable" || code === "artifact_unavailable") return false;
  return result.status === "BLOCKED" || hasSevereVisualFindings(result);
}

async function visualBlockedOutcome(state: WorkflowState, visual: VisualQAPhase): Promise<RunOutcome> {
  const message = `Visual QA blocked the workflow: ${visual.result?.summary ?? "configured gate did not pass"}`;
  await blockWorkflow(state.workflow_id, message);
  return { reason: "blocked", workflowId: state.workflow_id, status: "blocked", message };
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
      const workspace = await runIntegrationPhase(state, onEvent);
      const teamConfig = await loadTeamConfig();
      const visual = await runVisualQAPhase(state, workspace, teamConfig, options.visualQAService ?? new VisualQAService(visualQAProviders), onEvent);
      if (visual.fixesCreated) {
        detail.push({ iteration, summary: `visual QA iteration ${visual.iteration} requested frontend fixes` });
        continue;
      }
      if (visual.blocking) return { ...(await visualBlockedOutcome(state, visual)), ...(detail.length ? { detail } : {}) };
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
      const workspace = await runIntegrationPhase(fresh, onEvent);
      const teamConfig = await loadTeamConfig();
      const visual = await runVisualQAPhase(fresh, workspace, teamConfig, options.visualQAService ?? new VisualQAService(visualQAProviders), onEvent);
      if (visual.fixesCreated) {
        detail.push({ iteration, summary: `visual QA iteration ${visual.iteration} requested frontend fixes` });
        continue;
      }
      if (visual.blocking) return { ...(await visualBlockedOutcome(fresh, visual)), ...(detail.length ? { detail } : {}) };

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
