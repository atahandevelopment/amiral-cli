#!/usr/bin/env node

import {
  cleanupAllWorkflows,
  cleanupWorkflow,
  formatBytes,
  getWorktreeUsage,
} from "./lib/worktree-lifecycle.js";
import { loadState } from "./lib/workflow-store.js";

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "usage") {
    const usage = await getWorktreeUsage();
    if (!usage.length) {
      console.log("No Amiral task worktrees found.");
      return;
    }

    let total = 0;
    console.log("Amiral worktree disk usage");
    console.log("────────────────────────────────────────");

    for (const item of usage) {
      total += item.bytes;
      console.log(`${formatBytes(item.bytes).padStart(10)}  ${item.path}`);
    }

    console.log("");
    console.log(`Total: ${formatBytes(total)}`);
    return;
  }

  if (command !== "clean") {
    fail(
      "Usage:\n" +
      "  npx tsx scripts/worktree-clean.ts usage\n" +
      "  npx tsx scripts/worktree-clean.ts clean --workflow <id>\n" +
      "  npx tsx scripts/worktree-clean.ts clean --all\n" +
      "Options: --dry-run --delete-branches --remove-failed --remove-blocked"
    );
  }

  let workflowId: string | undefined;
  let all = false;
  let dryRun = false;
  let keepBranches = true;
  let keepFailed = true;
  let keepBlocked = true;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--workflow" || arg === "-w") {
      workflowId = args[i + 1];
      if (!workflowId) fail(`${arg} requires a workflow id.`);
      i += 1;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--delete-branches") {
      keepBranches = false;
    } else if (arg === "--remove-failed") {
      keepFailed = false;
    } else if (arg === "--remove-blocked") {
      keepBlocked = false;
    } else {
      fail(`Unknown argument: "${arg}".`);
    }
  }

  if (!workflowId && !all) {
    fail('Specify "--workflow <id>" or "--all".');
  }

  const policy = {
    cleanupCompleted: true,
    keepFailed,
    keepBlocked,
    keepBranches,
  };

  if (dryRun) {
    console.log("Dry run cleanup policy:");
    console.log(JSON.stringify(policy, null, 2));
    console.log("\nNo files, worktrees, or branches were changed.");
    return;
  }

  if (all) {
    for (const item of await cleanupAllWorkflows(policy)) {
      if (item.removed.length) {
        console.log(`✓ ${item.workflowId}: removed ${item.removed.join(", ")}`);
      }
    }
    return;
  }

  const state = await loadState(workflowId);
  const removed = await cleanupWorkflow(state, policy);

  if (!removed.length) {
    console.log("No worktrees matched the cleanup policy.");
    return;
  }

  console.log(`✓ Removed worktrees: ${removed.join(", ")}`);
}

void main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
