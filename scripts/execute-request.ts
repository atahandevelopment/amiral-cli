#!/usr/bin/env node

import { resolve } from "node:path";
import type { ExecutionRequest } from "./lib/execution-request.js";
import type { AgentResult } from "./lib/opencode-adapter.js";
import {
  executeWithOpenCode,
} from "./lib/opencode-adapter.js";
import { loadTeamConfig } from "./lib/team-config.js";
import {
  appendHistory,
  deriveWorkflowStatus,
  loadJson,
  loadState,
  saveState,
} from "./lib/workflow-store.js";

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
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
      `Cannot apply stale result for "${task.id}": active lease changed.`,
    );
  }

  const previousWorkflowStatus = state.status;
  const timestamp = new Date().toISOString();

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
    message: `Validated agent result applied: ${result.status}.`,
  });

  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "task_status_changed",
    task_id: task.id,
    message: `in_progress -> ${task.status} (validated OpenCode result)`,
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

async function main(): Promise<void> {
  const requestPath = process.argv[2];

  if (!requestPath) {
    fail(
      "Usage: npx tsx scripts/execute-request.ts <execution-request.json>",
    );
  }

  try {
    const absolute = resolve(process.cwd(), requestPath);
    const request = await loadJson<ExecutionRequest>(absolute);
    const teamConfig = await loadTeamConfig();

    console.log(`Executing: ${request.task_id} -> ${request.agent}`);

    const result = await executeWithOpenCode(request, teamConfig);

    await applyResult(request, result);

    console.log("");
    console.log(`✅ ${request.task_id}: ${result.status}`);
    console.log(result.summary);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
