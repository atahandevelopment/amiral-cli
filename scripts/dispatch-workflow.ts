#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { ExecutionRequest } from "./lib/execution-request.js";
import type { WorkflowState } from "./lib/types.js";
import { executeWithOpenCode } from "./lib/opencode-adapter.js";
import { loadTeamConfig, resolveExecutionConfig } from "./lib/team-config.js";
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

type DispatchResult = {
  taskId: string;
  agent: string;
  status: "completed" | "failed" | "blocked" | "error";
  summary: string;
  branch?: string;
  worktree?: string;
  commit?: string;
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
  result: Awaited<ReturnType<typeof executeWithOpenCode>>,
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
): Promise<DispatchResult> {
  const teamConfig = await loadTeamConfig();

  try {
    const worktree = await createTaskWorktree(
      request.workflow_id,
      request.task_id,
    );

    console.log(`[${request.task_id}] worktree: ${worktree.worktreePath}`);

    const result = await executeWithOpenCode(request, teamConfig, {
      cwd: worktree.worktreePath,
    });

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
    return {
      taskId: request.task_id,
      agent: request.agent,
      status: "error",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
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
      `Dispatching ${requests.length} task(s) with isolated Git worktrees...`,
    );

    const results = await runPool(
      requests,
      execution.max_parallel_agents,
      executeRequest,
    );

    printSummary(results);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
