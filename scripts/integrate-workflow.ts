#!/usr/bin/env node

import { loadState } from "./lib/workflow-store.js";
import {
  createIntegrationWorkspace,
  getTaskBranchName,
  getIntegrationStatus,
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
    const integration =
      await createIntegrationWorkspace(
        state.workflow_id,
      );

    const implementationTasks =
      state.tasks.filter(
        (task) =>
          task.status === "completed" &&
          !["reviewer", "qa", "planner"].includes(
            task.agent,
          ),
      );

    if (!implementationTasks.length) {
      console.log(
        "No completed implementation tasks to integrate.",
      );
      return;
    }

    console.log(
      `Integration branch: ${integration.branchName}`,
    );
    console.log(
      `Integration worktree: ${integration.worktreePath}`,
    );
    console.log("");

    for (const task of implementationTasks) {
      const branch = getTaskBranchName(
        state.workflow_id,
        task.id,
      );

      console.log(
        `Merging ${task.id} from ${branch}...`,
      );

      await mergeTaskBranch(
        integration.worktreePath,
        branch,
      );

      console.log(`✓ ${task.id}`);
    }

    const status = await getIntegrationStatus(
      integration.worktreePath,
    );

    console.log("");
    console.log("Integration complete.");

    if (status) {
      console.log("");
      console.log("Integration worktree status:");
      console.log(status);
    }
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : String(error),
    );
  }
}

void main();
