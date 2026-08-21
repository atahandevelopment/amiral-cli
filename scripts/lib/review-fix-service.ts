/**
 * Phase 14 — Reusable review-fix loop service.
 *
 * Extracted from scripts/create-review-fixes.ts so a future CLI can apply
 * a review-fix round without spawning the script. Behavior is unchanged:
 *
 *   - the review result file is fingerprinted (sha256) and a fingerprint
 *     match short-circuits as "already processed"
 *   - CHANGES_REQUESTED findings become FIX-R<n>-xxx tasks appended to the
 *     workflow through appendFixTasks
 *   - PASS / BLOCKED rounds advance and record the loop state exactly
 *
 * This module never writes to the console and never exits the process.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentName } from "./types.js";
import type { ReviewGateResult } from "./review-fix-types.js";
import { createFixTasks } from "./review-fix-planner.js";
import { appendFixTasks } from "./workflow-mutator.js";
import {
  loadReviewLoopState,
  saveReviewLoopState,
} from "./review-loop-state.js";
import { loadState } from "./workflow-store.js";

export type ReviewFixVerdict = "PASS" | "CHANGES_REQUESTED" | "BLOCKED";

export type CreatedFixTask = {
  id: string;
  title: string;
  agent: AgentName;
};

export type ReviewFixRoundResult = {
  workflowId: string;
  verdict: ReviewFixVerdict;
  round: number;
  createdTasks: CreatedFixTask[];
  /** True when the review result fingerprint matched the last processed one. */
  fingerprintUnchanged: boolean;
  summary: string;
};

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

export type ApplyReviewFixRoundOptions = {
  workflowId?: string;
};

/**
 * Apply one review-fix round for a workflow (default: active workflow).
 */
export async function applyReviewFixRound(
  options: ApplyReviewFixRoundOptions = {},
): Promise<ReviewFixRoundResult> {
  const state = await loadState(options.workflowId);
  const loop = await loadReviewLoopState(state.workflow_id);
  const file = reviewResultPath(state.workflow_id);

  const source = await readFile(file, "utf8");
  const review = JSON.parse(source) as ReviewGateResult;
  const currentFingerprint = fingerprint(source);

  if (review.workflow_id !== state.workflow_id) {
    throw new Error("Review result workflow mismatch.");
  }

  if (loop.last_review_fingerprint === currentFingerprint) {
    return {
      workflowId: state.workflow_id,
      verdict: review.status,
      round: loop.round,
      createdTasks: [],
      fingerprintUnchanged: true,
      summary: review.summary,
    };
  }

  const nextRound = loop.round + 1;

  if (review.status === "CHANGES_REQUESTED") {
    const drafts = createFixTasks(
      review.findings,
      nextRound,
    );

    if (!drafts.length) {
      throw new Error(
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

    return {
      workflowId: state.workflow_id,
      verdict: review.status,
      round: loop.round,
      createdTasks: created.map((task) => ({
        id: task.id,
        title: task.title,
        agent: task.agent,
      })),
      fingerprintUnchanged: false,
      summary: review.summary,
    };
  }

  loop.round = nextRound;
  loop.last_review_status = review.status;
  loop.last_review_result_file = file;
  loop.last_review_fingerprint = currentFingerprint;

  await saveReviewLoopState(loop);

  if (review.status === "PASS") {
    return {
      workflowId: state.workflow_id,
      verdict: "PASS",
      round: loop.round,
      createdTasks: [],
      fingerprintUnchanged: false,
      summary: review.summary,
    };
  }

  if (review.status === "BLOCKED") {
    return {
      workflowId: state.workflow_id,
      verdict: "BLOCKED",
      round: loop.round,
      createdTasks: [],
      fingerprintUnchanged: false,
      summary: review.summary,
    };
  }

  throw new Error(`Unsupported review status: ${review.status}`);
}
