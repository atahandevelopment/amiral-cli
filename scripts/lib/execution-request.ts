import { resolve } from "node:path";
import type { RuntimeTask, WorkflowState } from "./types.js";
import type { TeamConfig } from "./team-config.js";
import { getAgentSkills } from "./team-config.js";
import { writeJson, workflowDir } from "./workflow-store.js";

export type ExecutionRequest = {
  workflow_id: string;
  task_id: string;
  agent: RuntimeTask["agent"];
  title: string;
  description: string;
  acceptance_criteria: string[];
  lease_id: string;
  attempt: number;
  max_attempts: number;
  created_at: string;
  context: {
    workflow_type: WorkflowState["workflow_type"];
    dependencies: string[];
    skills: string[];
    result_path: string;
  };
};

export function createExecutionRequest(
  state: WorkflowState,
  task: RuntimeTask,
  teamConfig: TeamConfig,
): ExecutionRequest {
  if (!task.lease_id) {
    throw new Error(
      `Task "${task.id}" cannot produce an execution request without a lease.`,
    );
  }

  if (!task.max_attempts) {
    throw new Error(
      `Task "${task.id}" cannot produce an execution request without a retry budget.`,
    );
  }

  const resultPath =
    `tasks/${state.workflow_id}/results/${task.id}.json`;

  return {
    workflow_id: state.workflow_id,
    task_id: task.id,
    agent: task.agent,
    title: task.title,
    description: task.description,
    acceptance_criteria: task.acceptance_criteria,
    lease_id: task.lease_id,
    attempt: task.attempts,
    max_attempts: task.max_attempts,
    created_at: new Date().toISOString(),
    context: {
      workflow_type: state.workflow_type,
      dependencies: task.dependencies,
      skills: getAgentSkills(teamConfig, task.agent),
      result_path: resultPath,
    },
  };
}

export async function writeExecutionRequest(
  state: WorkflowState,
  task: RuntimeTask,
  teamConfig: TeamConfig,
  requestsDirectory: string,
): Promise<string> {
  const request = createExecutionRequest(state, task, teamConfig);
  const relative =
    `tasks/${state.workflow_id}/${requestsDirectory}/${task.id}.json`;
  const absolute = resolve(
    workflowDir(state.workflow_id),
    requestsDirectory,
    `${task.id}.json`,
  );

  await writeJson(absolute, request);
  return relative;
}
