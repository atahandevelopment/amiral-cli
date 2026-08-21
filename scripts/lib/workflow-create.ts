import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  RuntimeTask,
  TaskGraph,
  WorkflowState,
  WorkflowType,
} from "./types.js";
import { validateTaskGraphSemantics } from "./task-graph.js";
import {
  appendHistory,
  graphFile,
  resultsDir,
  saveState,
  setActiveWorkflowId,
  writeJson,
} from "./workflow-store.js";

/**
 * Map source graph tasks to runtime tasks.
 *
 * The spread preserves optional routing and planning metadata (Phase 12)
 * while initializing the runtime execution fields.
 */
export function toRuntimeTasks(graph: TaskGraph): RuntimeTask[] {
  return graph.tasks.map((task) => ({
    ...task,
    status: "pending",
    attempts: 0,
    started_at: null,
    completed_at: null,
    last_error: null,
    result_file: null,
  }));
}

/**
 * Create a persistent workflow from an already-loaded task graph.
 *
 * This is the single shared implementation used by:
 * - `workflow-state.ts create`
 * - `workflow-state.ts create-from-plan` (Phase 12)
 *
 * Semantic validation (duplicate ids, unknown/self dependencies, cycles) is
 * enforced here so no invalid graph can ever become a workflow.
 */
export async function createWorkflowFromGraph(options: {
  type: WorkflowType;
  graph: TaskGraph;
  /** Path recorded in state.source_graph for traceability. */
  graphSource: string;
  name?: string;
}): Promise<WorkflowState> {
  const { type, graph, graphSource, name } = options;

  if (!Array.isArray(graph.tasks) || graph.tasks.length === 0) {
    throw new Error("Task graph must contain at least one task.");
  }

  validateTaskGraphSemantics(graph);

  const workflowId = `${name?.trim() || type}-${randomUUID().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  const state: WorkflowState = {
    workflow_id: workflowId,
    workflow_type: type,
    status: "planned",
    created_at: timestamp,
    updated_at: timestamp,
    source_graph: graphSource,
    tasks: toRuntimeTasks(graph),
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

  return state;
}
