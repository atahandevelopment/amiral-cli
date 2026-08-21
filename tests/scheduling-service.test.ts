import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { TeamConfig } from "../scripts/lib/team-config.js";
import type { TaskGraph } from "../scripts/lib/types.js";

/**
 * Scheduling resolves runtime paths from process.cwd() at module load time.
 * Modules are therefore imported dynamically AFTER chdir into a temporary
 * directory (same pattern as the workflow-create tests).
 */
describe("scheduling-service", () => {
  let tempRoot: string;
  let previousCwd: string;

  let scheduleOnce: typeof import("../scripts/lib/scheduling-service.js").scheduleOnce;
  let createWorkflowFromGraph: typeof import("../scripts/lib/workflow-create.js").createWorkflowFromGraph;
  let loadState: typeof import("../scripts/lib/workflow-store.js").loadState;
  let saveState: typeof import("../scripts/lib/workflow-store.js").saveState;
  let loadHistory: typeof import("../scripts/lib/workflow-store.js").loadHistory;

  /**
   * Explicit team config keeps the tests independent of team.yaml.
   * Concurrency 2 lets two candidates be selected in the same round so
   * conflict-hold behavior between same-round claims is observable.
   */
  const teamConfig: TeamConfig = {
    providers: {
      opencode: { max_concurrency: 2 },
    },
  };

  function simpleGraph(tasks: TaskGraph["tasks"]): TaskGraph {
    return { tasks };
  }

  function leaseTask(
    state: import("../scripts/lib/types.js").WorkflowState,
    taskId: string,
    leaseId: string,
  ): void {
    const task = state.tasks.find((item) => item.id === taskId)!;

    task.status = "in_progress";
    task.attempts = 1;
    task.max_attempts = 3;
    task.started_at = new Date().toISOString();
    task.lease_id = leaseId;
    task.lease_expires_at = new Date(Date.now() + 600_000).toISOString();
  }

  before(() => {
    previousCwd = process.cwd();
    tempRoot = mkdtempSync(join(tmpdir(), "amiral-phase14-sched-"));
    process.chdir(tempRoot);

    return Promise.all([
      import("../scripts/lib/scheduling-service.js"),
      import("../scripts/lib/workflow-create.js"),
      import("../scripts/lib/workflow-store.js"),
    ]).then(([schedMod, createMod, storeMod]) => {
      scheduleOnce = schedMod.scheduleOnce;
      createWorkflowFromGraph = createMod.createWorkflowFromGraph;
      loadState = storeMod.loadState;
      saveState = storeMod.saveState;
      loadHistory = storeMod.loadHistory;
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

  it("claims a ready task: lease, attempt counter, and request file written", async () => {
    const state = await createWorkflowFromGraph({
      type: "feature",
      graphSource: "inline",
      graph: simpleGraph([
        {
          id: "IMPL-1",
          title: "Implement the thing",
          agent: "backend",
          description: "d",
          dependencies: [],
          acceptance_criteria: ["c"],
        },
      ]),
    });

    const result = await scheduleOnce({ state, teamConfig });

    assert.equal(result.blocked, false);
    assert.equal(result.conflictHolds.length, 0);
    assert.equal(result.claims.length, 1);

    const claim = result.claims[0]!;
    assert.equal(claim.taskId, "IMPL-1");
    assert.equal(claim.agent, "backend");
    assert.equal(claim.title, "Implement the thing");
    assert.equal(
      claim.requestFile,
      `tasks/${state.workflow_id}/requests/IMPL-1.json`,
    );

    const reloaded = await loadState(state.workflow_id);
    const task = reloaded.tasks[0]!;

    assert.equal(task.status, "in_progress");
    assert.equal(task.attempts, 1);
    assert.equal(task.max_attempts, 3);
    assert.ok(task.lease_id);
    assert.ok(task.lease_expires_at);
    assert.ok(task.started_at);
    assert.equal(reloaded.status, "running");

    const requestFile = join(
      "tasks",
      state.workflow_id,
      "requests",
      "IMPL-1.json",
    );
    assert.ok(existsSync(requestFile));

    const request = JSON.parse(readFileSync(requestFile, "utf8"));
    assert.equal(request.task_id, "IMPL-1");
    assert.equal(request.lease_id, task.lease_id);
    assert.equal(request.attempt, 1);

    const history = await loadHistory(state.workflow_id);
    assert.ok(history.some((event) => event.event === "task_claimed"));
  });

  it("dry-run reports the claim but writes nothing", async () => {
    const state = await createWorkflowFromGraph({
      type: "feature",
      graphSource: "inline",
      graph: simpleGraph([
        {
          id: "DRY-1",
          title: "Preview me",
          agent: "backend",
          description: "d",
          dependencies: [],
          acceptance_criteria: ["c"],
        },
      ]),
    });

    const stateFile = join("tasks", state.workflow_id, "state.json");
    const before = readFileSync(stateFile, "utf8");

    const result = await scheduleOnce({ state, dryRun: true, teamConfig });

    assert.equal(result.blocked, false);
    assert.equal(result.claims.length, 1);
    assert.equal(result.claims[0]!.taskId, "DRY-1");

    // State file byte-identical: no claims persisted.
    assert.equal(readFileSync(stateFile, "utf8"), before);

    // No execution request directory or file was created.
    assert.ok(!existsSync(join("tasks", state.workflow_id, "requests")));

    const persisted = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(persisted.tasks[0].status, "pending");
    assert.equal(persisted.tasks[0].attempts, 0);

    const history = await loadHistory(state.workflow_id);
    assert.ok(!history.some((event) => event.event === "task_claimed"));
  });

  it("holds a dependency-independent task that shares a conflict domain with a leased task", async () => {
    const state = await createWorkflowFromGraph({
      type: "feature",
      graphSource: "inline",
      graph: simpleGraph([
        {
          id: "AUTH-API",
          title: "Login endpoint",
          agent: "backend",
          description: "d",
          dependencies: [],
          acceptance_criteria: ["c"],
          planning: { conflict_domains: ["auth-core"] },
        },
        {
          id: "AUTH-UI",
          title: "Login screen",
          agent: "frontend",
          description: "d",
          dependencies: [],
          acceptance_criteria: ["c"],
          planning: { conflict_domains: ["auth-core"] },
        },
      ]),
    });

    // Simulate a previous round: AUTH-API claimed and actively leased.
    leaseTask(state, "AUTH-API", "lease-auth-api");
    await saveState(state);

    const result = await scheduleOnce({
      state: await loadState(state.workflow_id),
      teamConfig,
    });

    assert.deepEqual(result.conflictHolds, [
      { taskId: "AUTH-UI", againstTaskId: "AUTH-API", domain: "auth-core" },
    ]);
    assert.equal(result.claims.length, 0);

    // The held task is untouched: advisory skip only.
    const reloaded = await loadState(state.workflow_id);
    const held = reloaded.tasks.find((item) => item.id === "AUTH-UI")!;

    assert.equal(held.status, "pending");
    assert.equal(held.attempts, 0);
    assert.equal(held.lease_id ?? null, null);

    // Holds are recorded only in the result: no history events.
    const history = await loadHistory(state.workflow_id);
    assert.equal(
      history.filter((event) => event.task_id === "AUTH-UI").length,
      0,
    );
  });

  it("serializes same-round candidates that share a conflict domain", async () => {
    const state = await createWorkflowFromGraph({
      type: "feature",
      graphSource: "inline",
      graph: simpleGraph([
        {
          id: "AUTH-API",
          title: "Login endpoint",
          agent: "backend",
          description: "d",
          dependencies: [],
          acceptance_criteria: ["c"],
          planning: { conflict_domains: ["auth-core"] },
        },
        {
          id: "AUTH-UI",
          title: "Login screen",
          agent: "frontend",
          description: "d",
          dependencies: [],
          acceptance_criteria: ["c"],
          planning: { conflict_domains: ["auth-core"] },
        },
      ]),
    });

    const result = await scheduleOnce({ state, teamConfig });

    // First candidate is claimed; the second waits for the next round.
    assert.equal(result.claims.length, 1);
    assert.equal(result.claims[0]!.taskId, "AUTH-API");
    assert.deepEqual(result.conflictHolds, [
      { taskId: "AUTH-UI", againstTaskId: "AUTH-API", domain: "auth-core" },
    ]);
  });

  it("does not hold dependency-ordered tasks that share a conflict domain", async () => {
    const state = await createWorkflowFromGraph({
      type: "feature",
      graphSource: "inline",
      graph: simpleGraph([
        {
          id: "AUTH-DB",
          title: "Schema migration",
          agent: "database",
          description: "d",
          dependencies: [],
          acceptance_criteria: ["c"],
          planning: { conflict_domains: ["auth-core"] },
        },
        {
          id: "AUTH-API",
          title: "Login endpoint",
          agent: "backend",
          description: "d",
          dependencies: ["AUTH-DB"],
          acceptance_criteria: ["c"],
          planning: { conflict_domains: ["auth-core"] },
        },
      ]),
    });

    // Lease the dependent task; its dependency stays the ready candidate.
    // Dependency-ordered pairs sharing a domain must NEVER be held.
    leaseTask(state, "AUTH-API", "lease-auth-api");
    await saveState(state);

    const result = await scheduleOnce({
      state: await loadState(state.workflow_id),
      teamConfig,
    });

    assert.deepEqual(result.conflictHolds, []);
    assert.equal(result.claims.length, 1);
    assert.equal(result.claims[0]!.taskId, "AUTH-DB");

    const reloaded = await loadState(state.workflow_id);
    assert.equal(
      reloaded.tasks.find((item) => item.id === "AUTH-DB")!.status,
      "in_progress",
    );
  });
});
