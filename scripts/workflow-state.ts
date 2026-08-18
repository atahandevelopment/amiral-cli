#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  RuntimeTask,
  TaskGraph,
  TaskStatus,
  WorkflowState,
  WorkflowType,
} from "./lib/types.js";
import { findReadyTasks } from "./lib/task-graph.js";
import {
  appendHistory,
  deriveWorkflowStatus,
  getActiveWorkflowId,
  graphFile,
  listWorkflowIds,
  loadJson,
  loadState,
  resultsDir,
  saveState,
  setActiveWorkflowId,
  stateFile,
  workflowExists,
  writeJson,
} from "./lib/workflow-store.js";

const ROOT = process.cwd();

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function getTask(state: WorkflowState, taskId: string): RuntimeTask {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) fail(`Task "${taskId}" does not exist.`);
  return task;
}

async function createWorkflow(
  type: WorkflowType,
  taskGraphPath: string,
  name?: string,
): Promise<void> {
  const graph = await loadJson<TaskGraph>(resolve(ROOT, taskGraphPath));

  if (!Array.isArray(graph.tasks) || graph.tasks.length === 0) {
    fail("Task graph must contain at least one task.");
  }

  const workflowId = `${name?.trim() || type}-${randomUUID().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  const state: WorkflowState = {
    workflow_id: workflowId,
    workflow_type: type,
    status: "planned",
    created_at: timestamp,
    updated_at: timestamp,
    source_graph: taskGraphPath,
    tasks: graph.tasks.map((task) => ({
      ...task,
      status: "pending",
      attempts: 0,
      started_at: null,
      completed_at: null,
      last_error: null,
      result_file: null,
    })),
  };

  await mkdir(resultsDir(workflowId), { recursive: true });
  await writeJson(graphFile(workflowId), graph);
  await saveState(state);
  await writeJson(resolve("tasks", workflowId, "history.json"), []);
  await appendHistory({
    timestamp,
    workflow_id: workflowId,
    event: "workflow_created",
    message: `Workflow created with ${state.tasks.length} tasks.`,
  });
  await setActiveWorkflowId(workflowId);

  console.log(`✅ Workflow created: ${workflowId}`);
}

async function showStatus(workflowId?: string): Promise<void> {
  const state = await loadState(workflowId);
  const readyIds = new Set(findReadyTasks(state.tasks).map((task) => task.id));

  console.log(`Workflow: ${state.workflow_id}`);
  console.log(`Type: ${state.workflow_type}`);
  console.log(`Status: ${state.status}`);
  console.log("");

  for (const task of state.tasks) {
    console.log(
      `${task.id.padEnd(14)} ${task.status.padEnd(12)} ${task.agent.padEnd(10)}${
        readyIds.has(task.id) ? " READY" : ""
      }`,
    );
  }
}

async function showReady(workflowId?: string): Promise<void> {
  const state = await loadState(workflowId);
  const ready = findReadyTasks(state.tasks);

  if (!ready.length) {
    console.log("No READY tasks.");
    return;
  }

  for (const task of ready) {
    console.log(`${task.id}\t${task.agent}\t${task.title}`);
  }
}

async function setTaskStatus(
  taskId: string,
  nextStatus: TaskStatus,
  message?: string,
  workflowId?: string,
): Promise<void> {
  const state = await loadState(workflowId);
  const task = getTask(state, taskId);
  const previousTaskStatus = task.status;
  const previousWorkflowStatus = state.status;
  const timestamp = new Date().toISOString();

  if (nextStatus === "in_progress") {
    const ready = findReadyTasks(state.tasks).some(
      (item) => item.id === task.id,
    );
    if (!ready) fail(`Task "${task.id}" is not READY.`);

    task.started_at ??= timestamp;
    task.attempts += 1;
    task.last_error = null;
  }

  if (nextStatus === "completed") {
    if (task.status !== "in_progress") {
      fail(`Task "${task.id}" must be in_progress before completion.`);
    }

    task.completed_at = timestamp;
    task.last_error = null;
  }

  if (nextStatus === "failed" || nextStatus === "blocked") {
    if (!message?.trim()) {
      fail(`${nextStatus} requires an explanatory message.`);
    }

    task.last_error = message.trim();
  }

  if (nextStatus === "pending") {
    task.started_at = null;
    task.completed_at = null;
    task.last_error = null;
    task.lease_id = null;
    task.lease_expires_at = null;

    // Manual reset starts a fresh execution budget.
    task.attempts = 0;
  }

  task.status = nextStatus;
  state.status = deriveWorkflowStatus(state);

  await saveState(state);
  await appendHistory({
    timestamp,
    workflow_id: state.workflow_id,
    event: "task_status_changed",
    task_id: task.id,
    message: `${previousTaskStatus} -> ${nextStatus}${message ? `: ${message}` : ""}`,
  });

  if (previousWorkflowStatus !== state.status) {
    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "workflow_status_changed",
      message: `${previousWorkflowStatus} -> ${state.status}`,
    });
  }

  console.log(`✅ ${task.id}: ${previousTaskStatus} -> ${nextStatus}`);
}

async function listWorkflows(): Promise<void> {
  const workflows = await listWorkflowIds();
  const active = await getActiveWorkflowId();

  if (!workflows.length) {
    console.log("No workflows found.");
    return;
  }

  for (const workflowId of workflows) {
    try {
      const state = await loadJson<WorkflowState>(stateFile(workflowId));
      const marker = workflowId === active ? "*" : " ";
      console.log(
        `${marker} ${workflowId.padEnd(32)} ${state.status.padEnd(10)} ${state.workflow_type}`,
      );
    } catch {
      console.log(`? ${workflowId} (invalid workflow state)`);
    }
  }
}

async function useWorkflow(workflowId: string): Promise<void> {
  if (!(await workflowExists(workflowId))) {
    fail(`Workflow "${workflowId}" does not exist.`);
  }

  await setActiveWorkflowId(workflowId);
  console.log(`✅ Active workflow: ${workflowId}`);
}

function usage(): never {
  console.error(
    `
Usage:
  npx tsx scripts/workflow-state.ts create <feature|bugfix|refactor> <task-graph.json> [name]
  npx tsx scripts/workflow-state.ts list
  npx tsx scripts/workflow-state.ts use <workflow-id>
  npx tsx scripts/workflow-state.ts status [workflow-id]
  npx tsx scripts/workflow-state.ts ready [workflow-id]
  npx tsx scripts/workflow-state.ts start <TASK-ID> [workflow-id]
  npx tsx scripts/workflow-state.ts complete <TASK-ID> [workflow-id]
  npx tsx scripts/workflow-state.ts fail <TASK-ID> "<reason>"
  npx tsx scripts/workflow-state.ts block <TASK-ID> "<reason>"
  npx tsx scripts/workflow-state.ts reset <TASK-ID> [workflow-id]
`.trim(),
  );

  process.exit(2);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  try {
    switch (command) {
      case "create": {
        const [type, graph, name] = args;
        if (
          !type ||
          !graph ||
          !["feature", "bugfix", "refactor"].includes(type)
        ) {
          usage();
        }
        await createWorkflow(type as WorkflowType, graph, name);
        return;
      }

      case "list":
        await listWorkflows();
        return;

      case "use":
        if (!args[0]) usage();
        await useWorkflow(args[0]);
        return;

      case "status":
        await showStatus(args[0]);
        return;

      case "ready":
        await showReady(args[0]);
        return;

      case "start":
        if (!args[0]) usage();
        await setTaskStatus(args[0], "in_progress", undefined, args[1]);
        return;

      case "complete":
        if (!args[0]) usage();
        await setTaskStatus(args[0], "completed", undefined, args[1]);
        return;

      case "fail":
        if (!args[0] || !args[1]) usage();
        await setTaskStatus(args[0], "failed", args.slice(1).join(" "));
        return;

      case "block":
        if (!args[0] || !args[1]) usage();
        await setTaskStatus(args[0], "blocked", args.slice(1).join(" "));
        return;

      case "reset":
        if (!args[0]) usage();
        await setTaskStatus(args[0], "pending", undefined, args[1]);
        return;

      default:
        usage();
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
