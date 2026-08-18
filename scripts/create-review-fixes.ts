#!/usr/bin/env node

import { resolve } from "node:path";
import type { ReviewGateResult } from "./lib/review-fix-types.js";
import { createFixTasks } from "./lib/review-fix-planner.js";
import { appendFixTasks } from "./lib/workflow-mutator.js";
import { loadReviewLoopState, saveReviewLoopState } from "./lib/review-loop-state.js";
import { loadJson, loadState } from "./lib/workflow-store.js";

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const workflowIdArg = process.argv[2];

  try {
    const state = await loadState(workflowIdArg);
    const loop = await loadReviewLoopState(state.workflow_id);

    const reviewFile = resolve(
      process.cwd(),
      ".amiral",
      "integration",
      state.workflow_id.toLowerCase(),
      ".amiral",
      "gates",
      "review-result.json",
    );

    const review = await loadJson<ReviewGateResult>(reviewFile);

    if (review.workflow_id !== state.workflow_id) {
      fail("Review result workflow mismatch.");
    }

    loop.round += 1;
    loop.last_review_status = review.status;
    loop.last_review_result_file = reviewFile;
    await saveReviewLoopState(loop);

    if (review.status === "PASS") {
      console.log(`✅ Review round ${loop.round}: PASS`);
      console.log("No fix tasks required. QA may run.");
      return;
    }

    if (review.status === "BLOCKED") {
      console.log(`⛔ Review round ${loop.round}: BLOCKED`);
      console.log(review.summary);
      return;
    }

    const drafts = createFixTasks(review.findings, loop.round);
    if (!drafts.length) {
      fail("Review requested changes but produced no actionable findings.");
    }

    const created = await appendFixTasks(state, drafts);

    console.log(`Review round ${loop.round}: CHANGES_REQUESTED`);
    console.log(`Created ${created.length} fix task(s):`);

    for (const task of created) {
      console.log(`  - ${task.id} [${task.agent}] ${task.title}`);
    }

    console.log("\nNext: run scheduler + dispatcher.");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
