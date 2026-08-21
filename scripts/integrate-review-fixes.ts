#!/usr/bin/env node

import { loadState } from "./lib/workflow-store.js";
import {
  branchExists,
  createIntegrationWorkspace,
  getTaskBranchName,
  mergeTaskBranch,
} from "./lib/integration.js";

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const workflowIdArg = process.argv[2];

  try {
    const state = await loadState(workflowIdArg);
    const integration = await createIntegrationWorkspace(state.workflow_id);

    const fixTasks = state.tasks.filter(
      (task) => task.status === "completed" && task.id.startsWith("FIX-"),
    );

    if (!fixTasks.length) {
      console.log("No completed fix tasks to integrate.");
      return;
    }

    for (const task of fixTasks) {
      const branch = getTaskBranchName(state.workflow_id, task.id);

      if (!(await branchExists(branch))) {
        fail(`Fix branch missing for ${task.id}: ${branch}`);
      }

      console.log(`Merging fix ${task.id} from ${branch}...`);
      await mergeTaskBranch(integration.worktreePath, branch);
      console.log(`✓ ${task.id}`);
    }

    console.log("\n✅ Fix integration complete. Run Review again.");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
