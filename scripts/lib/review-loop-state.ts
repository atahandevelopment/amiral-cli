import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = process.cwd();

export type ReviewLoopState = {
  workflow_id: string;
  round: number;
  last_review_status: "PASS" | "CHANGES_REQUESTED" | "BLOCKED" | null;
  last_review_result_file: string | null;
  last_review_fingerprint: string | null;
  updated_at: string;
};

function fileFor(workflowId: string): string {
  return resolve(ROOT, "tasks", workflowId, "review-loop.json");
}

export async function loadReviewLoopState(
  workflowId: string,
): Promise<ReviewLoopState> {
  try {
    const value = JSON.parse(
      await readFile(fileFor(workflowId), "utf8"),
    ) as Partial<ReviewLoopState>;

    return {
      workflow_id: workflowId,
      round: typeof value.round === "number" ? value.round : 0,
      last_review_status: value.last_review_status ?? null,
      last_review_result_file: value.last_review_result_file ?? null,
      last_review_fingerprint: value.last_review_fingerprint ?? null,
      updated_at: value.updated_at ?? new Date().toISOString(),
    };
  } catch {
    return {
      workflow_id: workflowId,
      round: 0,
      last_review_status: null,
      last_review_result_file: null,
      last_review_fingerprint: null,
      updated_at: new Date().toISOString(),
    };
  }
}

export async function saveReviewLoopState(
  state: ReviewLoopState,
): Promise<void> {
  const file = fileFor(state.workflow_id);

  await mkdir(dirname(file), { recursive: true });

  state.updated_at = new Date().toISOString();

  await writeFile(
    file,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}
