#!/usr/bin/env node

import type { WorkflowState } from "./lib/types.js";

import { loadState } from "./lib/workflow-store.js";

import { scheduleOnce } from "./lib/scheduling-service.js";

type CliOptions = {
  workflowId?: string;
  dryRun: boolean;
};

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  let workflowId: string | undefined;

  let dryRun = false;

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

      case "--dry-run":
        dryRun = true;
        break;

      default:
        fail(`Unknown argument: "${arg}".`);
    }
  }

  return {
    workflowId,
    dryRun,
  };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  try {
    const state: WorkflowState = await loadState(cli.workflowId);

    const result = await scheduleOnce({
      state,
      dryRun: cli.dryRun,
    });

    for (const lease of result.expiredLeases) {
      console.log(
        `⚠️ Expired lease: ${lease.taskId} ` +
          `(attempt ${lease.attempts}/${lease.maxAttempts})`,
      );
    }

    if (result.blocked) {
      console.log("Workflow is blocked. Resolve blocked tasks first.");

      return;
    }

    console.log(`Workflow: ${result.workflowId}`);

    console.log(`Team max parallel: ${result.teamMaxParallel}`);

    console.log(
      `Provider: ${result.providerName} (max concurrency: ${result.providerMaxConcurrency})`,
    );

    console.log(`Effective parallelism: ${result.effectiveParallelism}`);

    console.log(`Lease: ${result.leaseMinutes} minute(s)`);

    console.log(`Max attempts: ${result.maxAttempts}`);

    console.log("");

    if (result.waitingRetries.length) {
      console.log("Retry waiting:");

      for (const task of result.waitingRetries) {
        console.log(`  - ${task.taskId} [${task.agent}]`);
        console.log(`    provider: ${task.provider ?? result.providerName}`);
        console.log(`    reason: ${task.kind ?? "unknown"}`);
        console.log(`    retry at: ${task.retryAt ?? "<invalid>"}`);
        console.log(
          `    attempt: ${task.attempts}/${task.maxAttempts ?? result.maxAttempts}`,
        );
      }

      console.log("");
    }

    if (result.routingDecisions.length) {
      console.log("Routing:");

      for (const decision of result.routingDecisions) {
        console.log(
          `  ${decision.taskId}: ` +
            `${decision.previousAgent} -> ` +
            `${decision.selectedAgent}`,
        );

        console.log(
          `    capabilities: ` +
            `${decision.matchedCapabilities.join(", ")}`,
        );
      }

      console.log("");
    }

    if (result.conflictHolds.length) {
      console.log("Conflict holds:");

      for (const hold of result.conflictHolds) {
        console.log(
          `  - ${hold.taskId} held by ${hold.againstTaskId} ` +
            `(domain: ${hold.domain})`,
        );
      }

      console.log("");
    }

    if (!result.claims.length) {
      console.log("No tasks selected.");

      return;
    }

    console.log("Selected tasks:");

    for (const claim of result.claims) {
      console.log(`  - ${claim.taskId} [${claim.agent}] ${claim.title}`);
    }

    if (cli.dryRun) {
      console.log("");
      console.log("Dry run: no claims or execution requests were written.");

      return;
    }

    console.log("");
    console.log(`✅ Claimed ${result.claims.length} task(s).`);

    console.log("Execution requests:");

    for (const claim of result.claims) {
      console.log(`  - ${claim.requestFile}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
