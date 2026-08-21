#!/usr/bin/env node

import { applyReviewFixRound } from "./lib/review-fix-service.js";

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const workflowIdArg = process.argv[2];

  try {
    const result = await applyReviewFixRound({ workflowId: workflowIdArg });

    if (result.fingerprintUnchanged) {
      console.log(
        `Review result already processed for round ${result.round}.`,
      );
      console.log("No new fix tasks were created.");
      return;
    }

    if (result.verdict === "CHANGES_REQUESTED") {
      console.log(
        `Review round ${result.round}: CHANGES_REQUESTED`,
      );
      console.log(
        `Created ${result.createdTasks.length} fix task(s):`,
      );

      for (const task of result.createdTasks) {
        console.log(
          `  - ${task.id} [${task.agent}] ${task.title}`,
        );
      }

      console.log("");
      console.log(
        "Next: run scheduler + dispatcher.",
      );

      return;
    }

    if (result.verdict === "PASS") {
      console.log(
        `✅ Review round ${result.round}: PASS`,
      );
      console.log(
        "No fix tasks required. QA may run.",
      );
      return;
    }

    if (result.verdict === "BLOCKED") {
      console.log(
        `⛔ Review round ${result.round}: BLOCKED`,
      );
      console.log(result.summary);
      return;
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
