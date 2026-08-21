#!/usr/bin/env node

import type { ExecutionRequest } from "./lib/execution-request.js";
import {
  loadTeamConfig,
  resolveDefaultProviderName,
} from "./lib/team-config.js";
import {
  dispatchRequests,
  listDispatchableRequests,
  resolveDispatchConcurrency,
  type DispatchSummary,
} from "./lib/dispatcher-service.js";
import { loadState } from "./lib/workflow-store.js";
import { assertCleanWorkingTree } from "./lib/git-worktree.js";

type CliOptions = {
  workflowId?: string;
};

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  let workflowId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--workflow":
      case "-w":
        workflowId = args[index + 1];
        if (!workflowId) {
          fail(`${arg} requires a workflow id.`);
        }
        index += 1;
        break;

      default:
        fail(`Unknown argument: "${arg}".`);
    }
  }

  return { workflowId };
}

function printSummary(summary: DispatchSummary): void {
  console.log("");
  console.log("Dispatch summary");
  console.log("────────────────────────────────────────");

  for (const result of summary.results) {
    const isError = result.isError === true;

    const icon =
      isError
        ? "⚠"
        : result.outcome === "completed"
          ? "✓"
          : result.outcome === "retry_wait"
            ? "⏳"
            : result.outcome === "blocked"
              ? "!"
              : "✗";

    console.log(
      `${icon} ${result.taskId.padEnd(14)} ${result.agent.padEnd(10)} ${result.outcome}`,
    );

    if (result.branch) {
      console.log(`    branch: ${result.branch}`);
    }

    if (result.worktree) {
      console.log(`    worktree: ${result.worktree}`);
    }

    if (isError) {
      console.log(`    error: ${result.detail ?? "Unknown error."}`);
    }

    if (result.diagnostics?.length) {
      for (const line of result.diagnostics) {
        console.log(`    diagnostic: ${line}`);
      }
    }

    if (result.commit) {
      console.log(`    commit: ${result.commit}`);
    }
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  try {
    await assertCleanWorkingTree();

    const teamConfig = await loadTeamConfig();

    const providerName = resolveDefaultProviderName(teamConfig);

    // Defensive capacity enforcement: even if the scheduler miscounted,
    // the dispatcher never exceeds provider concurrency.
    const dispatchConcurrency = resolveDispatchConcurrency(teamConfig);

    const state = await loadState(cli.workflowId);

    if (state.status === "completed" || state.status === "cancelled") {
      fail(
        `Workflow "${state.workflow_id}" cannot be dispatched (${state.status}).`,
      );
    }

    const requests: ExecutionRequest[] = await listDispatchableRequests(state);

    if (!requests.length) {
      console.log("No dispatchable execution requests found.");
      return;
    }

    console.log(
      `Dispatching ${requests.length} task(s) via provider "${providerName}" ` +
        `with isolated Git worktrees (concurrency: ${dispatchConcurrency})...`,
    );

    const summary = await dispatchRequests({
      requests,
      teamConfig,
      concurrency: dispatchConcurrency,
      onEvent: (line) => console.log(line),
    });

    printSummary(summary);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
