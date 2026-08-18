#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ReviewGateResult } from "./lib/review-fix-types.js";
import { createFixTasks } from "./lib/review-fix-planner.js";
import { appendFixTasks } from "./lib/workflow-mutator.js";
import {
  loadReviewLoopState,
  saveReviewLoopState,
} from "./lib/review-loop-state.js";
import { loadState } from "./lib/workflow-store.js";

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function reviewResultPath(workflowId: string): string {
  return resolve(
    process.cwd(),
    ".amiral",
    "integration",
    workflowId.toLowerCase(),
    ".amiral",
    "gates",
    "review-result.json",
  );
}

function fingerprint(source: string): string {
  return createHash("sha256")
    .update(source, "utf8")
    .digest("hex");
}

async function main(): Promise<void> {
  const workflowIdArg = process.argv[2];

  try {
    const state = await loadState(workflowIdArg);
    const loop = await loadReviewLoopState(state.workflow_id);
    const file = reviewResultPath(state.workflow_id);

    const source = await readFile(file, "utf8");
    const review = JSON.parse(source) as ReviewGateResult;
    const currentFingerprint = fingerprint(source);

    if (review.workflow_id !== state.workflow_id) {
      fail("Review result workflow mismatch.");
    }

    if (loop.last_review_fingerprint === currentFingerprint) {
      console.log(
        `Review result already processed for round ${loop.round}.`,
      );
      console.log("No new fix tasks were created.");
      return;
    }

    const nextRound = loop.round + 1;

    if (review.status === "CHANGES_REQUESTED") {
      const drafts = createFixTasks(
        review.findings,
        nextRound,
      );

      if (!drafts.length) {
        fail(
          "Review requested changes but produced no actionable findings.",
        );
      }

      const created = await appendFixTasks(
        state,
        drafts,
      );

      loop.round = nextRound;
      loop.last_review_status = review.status;
      loop.last_review_result_file = file;
      loop.last_review_fingerprint = currentFingerprint;

      await saveReviewLoopState(loop);

      console.log(
        `Review round ${loop.round}: CHANGES_REQUESTED`,
      );
      console.log(
        `Created ${created.length} fix task(s):`,
      );

      for (const task of created) {
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

    loop.round = nextRound;
    loop.last_review_status = review.status;
    loop.last_review_result_file = file;
    loop.last_review_fingerprint = currentFingerprint;

    await saveReviewLoopState(loop);

    if (review.status === "PASS") {
      console.log(
        `✅ Review round ${loop.round}: PASS`,
      );
      console.log(
        "No fix tasks required. QA may run.",
      );
      return;
    }

    if (review.status === "BLOCKED") {
      console.log(
        `⛔ Review round ${loop.round}: BLOCKED`,
      );
      console.log(review.summary);
      return;
    }

    fail(`Unsupported review status: ${review.status}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
