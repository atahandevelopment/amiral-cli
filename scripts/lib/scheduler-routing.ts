import type {
  RuntimeTask,
  WorkflowState,
} from "./types.js";
import type { TeamConfig } from "./team-config.js";
import {
  selectAgentForTask,
  type CapabilityAwareTask,
  type RoutingDecision,
} from "./capability-scheduler.js";

export type ScheduledTask = {
  task: RuntimeTask;
  routingDecision?: RoutingDecision;
};

export function routeReadyTasks(
  tasks: RuntimeTask[],
  state: WorkflowState,
  config: TeamConfig,
): ScheduledTask[] {
  const result: ScheduledTask[] = [];

  for (const task of tasks) {
    const capabilityTask =
      task as CapabilityAwareTask;

    if (
      capabilityTask.routing?.mode === "auto"
    ) {
      const decision =
        selectAgentForTask(
          capabilityTask,
          config,
        );

      task.agent =
        decision.selectedAgent;

      result.push({
        task,
        routingDecision: decision,
      });

      continue;
    }

    result.push({
      task,
    });
  }

  return result;
}
