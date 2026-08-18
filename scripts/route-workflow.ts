#!/usr/bin/env node

import { loadTeamConfig } from "./lib/team-config.js";
import { routeWorkflowTasks } from "./lib/capability-scheduler.js";
import {
  appendHistory,
  loadState,
  saveState,
} from "./lib/workflow-store.js";

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const workflowIdArg = process.argv[2];

  try {
    const state = await loadState(workflowIdArg);
    const config = await loadTeamConfig();

    const decisions = routeWorkflowTasks(state, config);

    if (!decisions.length) {
      console.log("No pending auto-routed tasks found.");
      return;
    }

    await saveState(state);

    const timestamp = new Date().toISOString();

    for (const decision of decisions) {
      await appendHistory({
        timestamp,
        workflow_id: state.workflow_id,
        event: "task_status_changed",
        task_id: decision.taskId,
        message:
          `capability routing: ${decision.previousAgent} -> ${decision.selectedAgent}; ` +
          `required=[${decision.requiredCapabilities.join(", ")}]`,
      });
    }

    console.log(`Routed ${decisions.length} task(s):`);

    for (const decision of decisions) {
      console.log(`  ✓ ${decision.taskId} -> ${decision.selectedAgent}`);
      console.log(`    capabilities: ${decision.matchedCapabilities.join(", ")}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
