import test from "node:test";
import assert from "node:assert/strict";
import { exitCodeForRunOutcome } from "../src/cli/commands/run.js";

test("every run stop reason has a documented exit code", () => {
  assert.deepEqual(Object.fromEntries(["completed","retry_scheduled","blocked","max_review_rounds","failed","no_progress","needs_input","interrupted"].map(reason => [reason, exitCodeForRunOutcome(reason as any)])), {
    completed:0,retry_scheduled:0,blocked:4,max_review_rounds:4,failed:1,no_progress:1,needs_input:4,interrupted:130,
  });
});
