#!/usr/bin/env node

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type WorkflowState = {
  workflow_id: string;
  workflow_type: "feature" | "bugfix" | "refactor";
  status: "planned" | "running" | "blocked" | "failed" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
  source_graph: string;
  tasks: Array<{
    id: string;
    title: string;
    agent: string;
    description: string;
    dependencies: string[];
    acceptance_criteria: string[];
    status: "pending" | "in_progress" | "completed" | "failed" | "blocked" | "cancelled";
    attempts: number;
    started_at: string | null;
    completed_at: string | null;
    last_error: string | null;
    result_file: string | null;
  }>;
};

const ROOT = process.cwd();
const TASKS_ROOT = resolve(ROOT, "tasks");
const ACTIVE_FILE = resolve(TASKS_ROOT, ".active-workflow");

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function writeText(file: string, value: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, value, "utf8");
}

async function loadJson<T>(file: string): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    fail(
      `Could not read "${file}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function stateFile(workflowId: string): string {
  return resolve(TASKS_ROOT, workflowId, "state.json");
}

async function listWorkflowIds(): Promise<string[]> {
  await mkdir(TASKS_ROOT, { recursive: true });

  const entries = await readdir(TASKS_ROOT, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function getActiveWorkflowId(): Promise<string | null> {
  try {
    const id = (await readFile(ACTIVE_FILE, "utf8")).trim();
    return id || null;
  } catch {
    return null;
  }
}

async function setActiveWorkflow(workflowId: string): Promise<void> {
  await writeText(ACTIVE_FILE, `${workflowId}\n`);
}

async function ensureWorkflow(workflowId: string): Promise<void> {
  try {
    await loadJson<WorkflowState>(stateFile(workflowId));
  } catch {
    fail(`Workflow "${workflowId}" does not exist or is invalid.`);
  }
}

async function resolveWorkflowId(explicit?: string): Promise<string> {
  if (explicit?.trim()) {
    const id = explicit.trim();
    await ensureWorkflow(id);
    return id;
  }

  const active = await getActiveWorkflowId();

  if (active) {
    await ensureWorkflow(active);
    return active;
  }

  const workflowIds = await listWorkflowIds();

  if (workflowIds.length === 0) {
    fail("No workflow exists. Create one first.");
  }

  if (workflowIds.length === 1) {
    const [onlyWorkflow] = workflowIds;
    await ensureWorkflow(onlyWorkflow);
    await setActiveWorkflow(onlyWorkflow);

    console.log(`ℹ️ No active workflow was set. Auto-selected: ${onlyWorkflow}`);
    return onlyWorkflow;
  }

  fail(
    `No active workflow is set and ${workflowIds.length} workflows exist. ` +
      `Run "npx tsx scripts/workflow-state-select.ts use <workflow-id>" ` +
      `or pass the workflow ID explicitly.`,
  );
}

async function listWorkflows(): Promise<void> {
  const workflowIds = await listWorkflowIds();
  const active = await getActiveWorkflowId();

  if (workflowIds.length === 0) {
    console.log("No workflows found.");
    return;
  }

  for (const workflowId of workflowIds) {
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
  await ensureWorkflow(workflowId);
  await setActiveWorkflow(workflowId);
  console.log(`✅ Active workflow: ${workflowId}`);
}

async function currentWorkflow(explicit?: string): Promise<void> {
  const workflowId = await resolveWorkflowId(explicit);
  const state = await loadJson<WorkflowState>(stateFile(workflowId));

  console.log(`Workflow: ${state.workflow_id}`);
  console.log(`Type: ${state.workflow_type}`);
  console.log(`Status: ${state.status}`);
}

function usage(): never {
  console.error(`
Usage:
  npx tsx scripts/workflow-state-select.ts list
  npx tsx scripts/workflow-state-select.ts use <workflow-id>
  npx tsx scripts/workflow-state-select.ts current [workflow-id]

Behavior:
  - explicit workflow ID wins
  - otherwise .active-workflow is used
  - if no active workflow exists and exactly one workflow exists, it is auto-selected
  - if multiple workflows exist, explicit selection is required
`.trim());

  process.exit(2);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "list":
      await listWorkflows();
      return;

    case "use":
      if (!args[0]) usage();
      await useWorkflow(args[0]);
      return;

    case "current":
      await currentWorkflow(args[0]);
      return;

    default:
      usage();
  }
}

void main();
