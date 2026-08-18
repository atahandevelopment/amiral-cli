#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import type { RuntimeTask, WorkflowState } from "./lib/types.js";

import { findReadyTasks } from "./lib/task-graph.js";

import { loadTeamConfig, resolveExecutionConfig } from "./lib/team-config.js";

import { writeExecutionRequest } from "./lib/execution-request.js";

import {
  appendHistory,
  deriveWorkflowStatus,
  loadState,
  saveState,
} from "./lib/workflow-store.js";

import { routeReadyTasks } from "./lib/scheduler-routing.js";

import { getProviderCapacity } from "./lib/provider-capacity.js";

type CliOptions = {
  workflowId?: string;
  dryRun: boolean;
};

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  let workflowId: string | undefined;

  let dryRun = false;

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

      case "--dry-run":
        dryRun = true;
        break;

      default:
        fail(`Unknown argument: "${arg}".`);
    }
  }

  return {
    workflowId,
    dryRun,
  };
}

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

function getRunningTasks(state: WorkflowState): RuntimeTask[] {
  return state.tasks.filter(
    (task) => task.status === "in_progress" && !isLeaseExpired(task),
  );
}

async function recoverExpiredLeases(
  state: WorkflowState,
  defaultMaxAttempts: number,
  dryRun: boolean,
): Promise<void> {
  const expired = state.tasks.filter(isLeaseExpired);

  if (!expired.length) {
    return;
  }

  const timestamp = new Date().toISOString();

  for (const task of expired) {
    const maxAttempts = task.max_attempts || defaultMaxAttempts;

    console.log(
      `⚠️ Expired lease: ${task.id} ` +
        `(attempt ${task.attempts}/${maxAttempts})`,
    );

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
}

function chooseTasks(state: WorkflowState, maxParallel: number): RuntimeTask[] {
  const running = getRunningTasks(state);

  const slots = Math.max(0, maxParallel - running.length);

  if (!slots) {
    return [];
  }

  return findReadyTasks(state.tasks).slice(0, slots);
}

async function claimTasksAndEmitRequests(
  state: WorkflowState,
  selected: RuntimeTask[],
  teamConfig: Awaited<ReturnType<typeof loadTeamConfig>>,
  execution: ReturnType<typeof resolveExecutionConfig>,
): Promise<string[]> {
  const timestamp = new Date().toISOString();

  const previousWorkflowStatus = state.status;

  const requestFiles: string[] = [];

  for (const selectedTask of selected) {
    const task = state.tasks.find((item) => item.id === selectedTask.id);

    if (!task || task.status !== "pending") {
      throw new Error(
        `Task "${selectedTask.id}" changed before scheduler claim.`,
      );
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

    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "task_claimed",
      task_id: task.id,
      message:
        `Task claimed with lease ${task.lease_id}; ` +
        `attempt ${task.attempts}/${task.max_attempts}.`,
    });

    const requestFile = await writeExecutionRequest(
      state,
      task,
      teamConfig,
      execution.requests_directory,
    );

    requestFiles.push(requestFile);
  }

  state.status = deriveWorkflowStatus(state);

  await saveState(state);

  if (previousWorkflowStatus !== state.status) {
    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "workflow_status_changed",
      message: `${previousWorkflowStatus} -> ${state.status}`,
    });
  }

  return requestFiles;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  try {
    const teamConfig = await loadTeamConfig();

    const execution = resolveExecutionConfig(teamConfig);

    const providerCapacity = getProviderCapacity(teamConfig, "opencode");

    const effectiveParallelism = Math.min(
      execution.max_parallel_agents,
      providerCapacity.maxConcurrency,
    );

    const state = await loadState(cli.workflowId);

    if (state.status === "completed" || state.status === "cancelled") {
      fail(
        `Workflow "${state.workflow_id}" cannot be scheduled (${state.status}).`,
      );
    }

    await recoverExpiredLeases(state, execution.max_attempts, cli.dryRun);

    const refreshed = cli.dryRun ? state : await loadState(cli.workflowId);

    if (refreshed.status === "blocked") {
      console.log("Workflow is blocked. Resolve blocked tasks first.");

      return;
    }

    const readyTasks = chooseTasks(refreshed, effectiveParallelism);

    const routed = routeReadyTasks(readyTasks, refreshed, teamConfig);

    const selected = routed.map((item) => item.task);

    console.log(`Workflow: ${refreshed.workflow_id}`);

    console.log(`Team max parallel: ${execution.max_parallel_agents}`);

    console.log(`OpenCode max concurrency: ${providerCapacity.maxConcurrency}`);

    console.log(`Effective parallelism: ${effectiveParallelism}`);

    console.log(`Lease: ${execution.lease_minutes} minute(s)`);

    console.log(`Max attempts: ${execution.max_attempts}`);

    console.log("");

    if (routed.some((item) => item.routingDecision)) {
      console.log("Routing:");

      for (const item of routed) {
        if (!item.routingDecision) {
          continue;
        }

        console.log(
          `  ${item.task.id}: ` +
            `${item.routingDecision.previousAgent} -> ` +
            `${item.routingDecision.selectedAgent}`,
        );

        console.log(
          `    capabilities: ` +
            `${item.routingDecision.matchedCapabilities.join(", ")}`,
        );
      }

      console.log("");
    }

    if (!selected.length) {
      console.log("No tasks selected.");

      return;
    }

    console.log("Selected tasks:");

    for (const task of selected) {
      console.log(`  - ${task.id} [${task.agent}] ${task.title}`);
    }

    if (cli.dryRun) {
      console.log("");
      console.log("Dry run: no claims or execution requests were written.");

      return;
    }

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

    const requestFiles = await claimTasksAndEmitRequests(
      refreshed,
      selected,
      teamConfig,
      execution,
    );

    console.log("");
    console.log(`✅ Claimed ${requestFiles.length} task(s).`);

    console.log("Execution requests:");

    for (const file of requestFiles) {
      console.log(`  - ${file}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
