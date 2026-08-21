import type { RuntimeTask, WorkflowState } from "./types.js";
import type { FixTaskDraft } from "./review-fix-types.js";
import { appendHistory, saveState } from "./workflow-store.js";

export async function appendFixTasks(
  state: WorkflowState,
  drafts: FixTaskDraft[],
  defaultMaxAttempts = 3,
): Promise<RuntimeTask[]> {
  const existing = new Set(state.tasks.map((task) => task.id));
  const created: RuntimeTask[] = [];
  const timestamp = new Date().toISOString();

  for (const draft of drafts) {
    if (existing.has(draft.id)) continue;

    const task: RuntimeTask = {
      id: draft.id,
      title: draft.title,
      agent: draft.agent,
      description: draft.description,
      dependencies: draft.dependencies,
      acceptance_criteria: draft.acceptance_criteria,
      status: "pending",
      attempts: 0,
      max_attempts: defaultMaxAttempts,
      started_at: null,
      completed_at: null,
      last_error: null,
      result_file: null,
      lease_id: null,
      lease_expires_at: null,
    };

    state.tasks.push(task);
    existing.add(task.id);
    created.push(task);

    await appendHistory({
      timestamp,
      workflow_id: state.workflow_id,
      event: "task_status_changed",
      task_id: task.id,
      message: "review finding -> pending fix task",
    });
  }

  if (created.length) {
    state.status = "running";
    await saveState(state);
  }

  return created;
}
