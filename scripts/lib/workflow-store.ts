import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  HistoryEvent,
  WorkflowState,
  WorkflowStatus,
} from "./types.js";

const ROOT = process.cwd();

export const TASKS_ROOT = resolve(ROOT, "tasks");
export const ACTIVE_WORKFLOW_FILE = resolve(TASKS_ROOT, ".active-workflow");

export function workflowDir(workflowId: string): string {
  return resolve(TASKS_ROOT, workflowId);
}

export function stateFile(workflowId: string): string {
  return resolve(workflowDir(workflowId), "state.json");
}

export function historyFile(workflowId: string): string {
  return resolve(workflowDir(workflowId), "history.json");
}

export function graphFile(workflowId: string): string {
  return resolve(workflowDir(workflowId), "task-graph.json");
}

export function resultsDir(workflowId: string): string {
  return resolve(workflowDir(workflowId), "results");
}

export async function writeJson(
  file: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function listWorkflowIds(): Promise<string[]> {
  await mkdir(TASKS_ROOT, { recursive: true });

  const entries = await readdir(TASKS_ROOT, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export async function getActiveWorkflowId(): Promise<string | null> {
  try {
    const value = (await readFile(ACTIVE_WORKFLOW_FILE, "utf8")).trim();
    return value || null;
  } catch {
    return null;
  }
}

export async function setActiveWorkflowId(
  workflowId: string,
): Promise<void> {
  await mkdir(TASKS_ROOT, { recursive: true });
  await writeFile(ACTIVE_WORKFLOW_FILE, `${workflowId}\n`, "utf8");
}

export async function workflowExists(workflowId: string): Promise<boolean> {
  try {
    await loadJson<WorkflowState>(stateFile(workflowId));
    return true;
  } catch {
    return false;
  }
}

export async function resolveWorkflowId(
  explicit?: string,
): Promise<string> {
  if (explicit?.trim()) {
    const id = explicit.trim();

    if (!(await workflowExists(id))) {
      throw new Error(`Workflow "${id}" does not exist or is invalid.`);
    }

    return id;
  }

  const active = await getActiveWorkflowId();

  if (active && (await workflowExists(active))) {
    return active;
  }

  const workflows = await listWorkflowIds();

  if (workflows.length === 0) {
    throw new Error("No workflow exists.");
  }

  if (workflows.length === 1) {
    const only = workflows[0];
    await setActiveWorkflowId(only);
    return only;
  }

  throw new Error(
    `No active workflow is set and ${workflows.length} workflows exist.`,
  );
}

export async function loadState(
  workflowId?: string,
): Promise<WorkflowState> {
  const id = await resolveWorkflowId(workflowId);
  return loadJson<WorkflowState>(stateFile(id));
}

export async function saveState(
  state: WorkflowState,
): Promise<void> {
  state.updated_at = new Date().toISOString();
  await writeJson(stateFile(state.workflow_id), state);
}

export async function loadHistory(
  workflowId: string,
): Promise<HistoryEvent[]> {
  try {
    return await loadJson<HistoryEvent[]>(historyFile(workflowId));
  } catch {
    return [];
  }
}

export async function appendHistory(
  event: HistoryEvent,
): Promise<void> {
  const history = await loadHistory(event.workflow_id);
  history.push(event);
  await writeJson(historyFile(event.workflow_id), history);
}

export function deriveWorkflowStatus(
  state: WorkflowState,
): WorkflowStatus {
  if (state.tasks.every((task) => task.status === "completed")) {
    return "completed";
  }

  if (state.tasks.some((task) => task.status === "failed")) {
    return "failed";
  }

  if (
    state.tasks.some((task) => task.status === "blocked") &&
    !state.tasks.some((task) => task.status === "in_progress")
  ) {
    return "blocked";
  }

  if (
    state.tasks.some((task) =>
      ["in_progress", "completed"].includes(task.status),
    )
  ) {
    return "running";
  }

  return "planned";
}
