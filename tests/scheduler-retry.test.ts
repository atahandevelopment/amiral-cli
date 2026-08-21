import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  findDueRetryTasks,
  findWaitingRetryTasks,
} from "../scripts/lib/scheduler-retry.js";
import type { RuntimeTask } from "../scripts/lib/types.js";

function makeTask(overrides: Partial<RuntimeTask>): RuntimeTask {
  return {
    id: "T-1",
    title: "Task",
    agent: "backend",
    description: "d",
    dependencies: [],
    acceptance_criteria: ["c"],
    status: "pending",
    attempts: 1,
    started_at: null,
    completed_at: null,
    last_error: null,
    result_file: null,
    ...overrides,
  };
}

describe("scheduler-retry (selection rules)", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  it("ignores retry_wait tasks whose retry_not_before is in the future", () => {
    const tasks = [
      makeTask({
        status: "retry_wait",
        attempts: 1,
        max_attempts: 3,
        retry_not_before: "2026-08-21T12:00:30.000Z", // +30s
      }),
    ];

    assert.deepEqual(findDueRetryTasks(tasks, now), []);
    assert.equal(findWaitingRetryTasks(tasks, now).length, 1);
  });

  it("selects retry_wait tasks once retry_not_before has passed", () => {
    const task = makeTask({
      id: "T-DUE",
      status: "retry_wait",
      attempts: 2,
      max_attempts: 3,
      retry_not_before: "2026-08-21T11:59:59.000Z",
      last_provider_error: {
        provider: "opencode",
        kind: "unavailable",
        message: "503",
        retryable: true,
        status_code: 503,
      },
    });

    const due = findDueRetryTasks([task], now);

    assert.equal(due.length, 1);
    assert.equal(due[0]?.id, "T-DUE");
    assert.equal(findWaitingRetryTasks([task], now).length, 0);
  });

  it("treats missing or invalid retry timestamps as immediately eligible", () => {
    const tasks = [
      makeTask({ id: "T-NONE", status: "retry_wait" }),
      makeTask({
        id: "T-BAD",
        status: "retry_wait",
        retry_not_before: "not-a-date",
      }),
    ];

    assert.equal(findDueRetryTasks(tasks, now).length, 2);
  });

  it("never selects non-retry tasks through the retry helpers", () => {
    const tasks = [
      makeTask({ id: "P", status: "pending" }),
      makeTask({ id: "R", status: "in_progress" }),
      makeTask({ id: "C", status: "completed" }),
      makeTask({ id: "B", status: "blocked" }),
      makeTask({
        id: "W",
        status: "retry_wait",
        retry_not_before: "2026-08-21T09:00:00.000Z",
      }),
    ];

    const due = findDueRetryTasks(tasks, now);

    assert.equal(due.length, 1);
    assert.equal(due[0]?.id, "W");
  });
});

describe("scheduler-retry (persistence)", () => {
  let tempRoot: string;
  let previousCwd: string;

  let promoteDueRetries: typeof import("../scripts/lib/scheduler-retry.js").promoteDueRetries;
  let createWorkflowFromGraph: typeof import("../scripts/lib/workflow-create.js").createWorkflowFromGraph;
  let loadState: typeof import("../scripts/lib/workflow-store.js").loadState;
  let saveState: typeof import("../scripts/lib/workflow-store.js").saveState;

  before(() => {
    previousCwd = process.cwd();
    tempRoot = mkdtempSync(join(tmpdir(), "amiral-phase13-sched-"));
    process.chdir(tempRoot);

    return Promise.all([
      import("../scripts/lib/scheduler-retry.js"),
      import("../scripts/lib/workflow-create.js"),
      import("../scripts/lib/workflow-store.js"),
    ]).then(([retryMod, createMod, storeMod]) => {
      promoteDueRetries = retryMod.promoteDueRetries;
      createWorkflowFromGraph = createMod.createWorkflowFromGraph;
      loadState = storeMod.loadState;
      saveState = storeMod.saveState;
    });
  });

  after(() => {
    process.chdir(previousCwd);
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Windows may briefly lock the directory; tests already passed.
    }
  });

  it("promotes due retries to pending and persists the transition", async () => {
    await createWorkflowFromGraph({
      type: "feature",
      graph: {
        tasks: [
          {
            id: "RETRY-1",
            title: "Retried task",
            agent: "backend",
            description: "d",
            dependencies: [],
            acceptance_criteria: ["c"],
          },
        ],
      },
      graphSource: "inline",
    });

    const past = new Date(Date.now() - 60_000).toISOString();

    // Simulate a persisted retry_wait state.
    const state = await loadState();
    const task = state.tasks[0]!;
    task.status = "retry_wait";
    task.attempts = 1;
    task.max_attempts = 3;
    task.retry_not_before = past;
    await saveState(state);

    const promoted = await promoteDueRetries(await loadState());

    assert.equal(promoted.length, 1);
    assert.equal(promoted[0]?.id, "RETRY-1");

    const reloaded = await loadState();
    assert.equal(reloaded.tasks[0]?.status, "pending");
    assert.equal(reloaded.tasks[0]?.retry_not_before, null);
  });

  it("leaves future retries untouched", async () => {
    const state = await loadState();
    const task = state.tasks[0]!;
    task.status = "pending";
    await saveState(state);

    const future = new Date(Date.now() + 600_000).toISOString();
    task.status = "retry_wait";
    task.retry_not_before = future;
    await saveState(state);

    const promoted = await promoteDueRetries(await loadState());

    assert.equal(promoted.length, 0);
    assert.equal((await loadState()).tasks[0]?.status, "retry_wait");
  });
});
