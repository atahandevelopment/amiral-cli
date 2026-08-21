import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * Provider retry state transitions run against real workflow files.
 * Modules are imported dynamically AFTER chdir into a temp directory so
 * workflow-store paths resolve there (same pattern as workflow-create tests).
 */
describe("provider-retry", () => {
  let tempRoot: string;
  let previousCwd: string;

  let createWorkflowFromGraph: typeof import("../scripts/lib/workflow-create.js").createWorkflowFromGraph;
  let loadState: typeof import("../scripts/lib/workflow-store.js").loadState;
  let saveState: typeof import("../scripts/lib/workflow-store.js").saveState;
  let loadHistory: typeof import("../scripts/lib/workflow-store.js").loadHistory;
  let applyProviderRetry: typeof import("../scripts/lib/provider-retry.js").applyProviderRetry;
  let applyPermanentProviderFailure: typeof import("../scripts/lib/provider-retry.js").applyPermanentProviderFailure;
  let maybeRecordProviderRecovery: typeof import("../scripts/lib/provider-retry.js").maybeRecordProviderRecovery;
  let ProviderError: typeof import("../scripts/lib/providers/provider-error.js").ProviderError;

  const retryConfig = {
    max_attempts: 3,
    base_delay_ms: 1000,
    max_delay_ms: 5000,
    jitter: false,
  };

  function makeRequest(taskId: string, leaseId: string): any {
    return {
      workflow_id: "",
      task_id: taskId,
      agent: "backend",
      title: "t",
      description: "d",
      acceptance_criteria: ["c"],
      lease_id: leaseId,
      attempt: 1,
      max_attempts: 3,
      created_at: new Date().toISOString(),
      context: {
        workflow_type: "feature",
        dependencies: [],
        skills: [],
        result_path: `tasks//results/${taskId}.json`,
      },
    };
  }

  async function claimFirstTask(): Promise<{ taskId: string; leaseId: string }> {
    const state = await loadState();
    const task = state.tasks[0]!;
    task.status = "in_progress";
    task.attempts = 1;
    task.max_attempts = 3;
    task.lease_id = "lease-1";
    task.lease_expires_at = new Date(Date.now() + 600_000).toISOString();
    await saveState(state);

    return { taskId: task.id, leaseId: "lease-1" };
  }

  before(() => {
    previousCwd = process.cwd();
    tempRoot = mkdtempSync(join(tmpdir(), "amiral-phase13-retry-"));
    process.chdir(tempRoot);

    return Promise.all([
      import("../scripts/lib/workflow-create.js"),
      import("../scripts/lib/workflow-store.js"),
      import("../scripts/lib/provider-retry.js"),
      import("../scripts/lib/providers/provider-error.js"),
    ]).then(([createMod, storeMod, retryMod, errorMod]) => {
      createWorkflowFromGraph = createMod.createWorkflowFromGraph;
      loadState = storeMod.loadState;
      saveState = storeMod.saveState;
      loadHistory = storeMod.loadHistory;
      applyProviderRetry = retryMod.applyProviderRetry;
      applyPermanentProviderFailure = retryMod.applyPermanentProviderFailure;
      maybeRecordProviderRecovery = retryMod.maybeRecordProviderRecovery;
      ProviderError = errorMod.ProviderError;
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

  it("moves a claimed task to retry_wait with persisted scheduling", async () => {
    await createWorkflowFromGraph({
      type: "feature",
      graphSource: "inline",
      graph: {
        tasks: [
          {
            id: "R-503",
            title: "Retryable failure",
            agent: "backend",
            description: "d",
            dependencies: [],
            acceptance_criteria: ["c"],
          },
        ],
      },
    });

    const { taskId, leaseId } = await claimFirstTask();

    const request = makeRequest(taskId, leaseId);
    request.workflow_id = (await loadState()).workflow_id;
    request.attempt = 1;

    const outcome = await applyProviderRetry({
      request,
      error: new ProviderError({
        provider: "opencode",
        kind: "unavailable",
        retryable: true,
        statusCode: 503,
        message: "service unavailable (503)",
      }),
      retryConfig,
    });

    assert.equal(outcome.outcome, "retry_wait");
    if (outcome.outcome !== "retry_wait") return;

    // Delay math: attempt 1 → base delay, no jitter.
    assert.equal(outcome.delayMs, 1000);

    const state = await loadState();
    const task = state.tasks[0]!;

    assert.equal(task.status, "retry_wait");
    assert.equal(task.lease_id, null);
    assert.equal(task.lease_expires_at, null);
    assert.ok(task.retry_not_before);
    assert.deepEqual(task.last_provider_error, {
      provider: "opencode",
      kind: "unavailable",
      message: "service unavailable (503)",
      retryable: true,
      status_code: 503,
    });

    // Workflow stays running while a retry is pending.
    assert.equal(state.status, "running");

    const history = await loadHistory(state.workflow_id);
    const events = history.map((event) => event.event);

    assert.ok(events.includes("provider_retry_scheduled"));
    assert.ok(events.includes("task_status_changed"));

    const scheduled = history.find(
      (event) => event.event === "provider_retry_scheduled",
    )!;

    assert.equal(scheduled.details?.["kind"], "unavailable");
    assert.equal(scheduled.details?.["attempt"], 1);
    assert.equal(scheduled.details?.["next_retry_at"], outcome.retryNotBefore);
  });

  it("blocks the task when the retry budget is exhausted", async () => {
    const state = await loadState();
    const task = state.tasks[0]!;
    task.status = "in_progress";
    task.attempts = 3; // budget exhausted
    task.max_attempts = 3;
    task.lease_id = "lease-2";
    await saveState(state);

    const request = makeRequest(task.id, "lease-2");
    request.workflow_id = state.workflow_id;

    const outcome = await applyProviderRetry({
      request,
      error: new ProviderError({
        provider: "opencode",
        kind: "rate_limit",
        retryable: true,
        message: "429 too many requests",
      }),
      retryConfig,
    });

    assert.equal(outcome.outcome, "blocked");

    const reloaded = await loadState();
    assert.equal(reloaded.tasks[0]?.status, "blocked");
    assert.match(reloaded.tasks[0]?.last_error ?? "", /retry budget/);
  });

  it("fails immediately on non-retryable provider errors and persists diagnostics", async () => {
    await createWorkflowFromGraph({
      type: "feature",
      graphSource: "inline",
      graph: {
        tasks: [
          {
            id: "P-AUTH",
            title: "Auth failure",
            agent: "backend",
            description: "d",
            dependencies: [],
            acceptance_criteria: ["c"],
          },
        ],
      },
    });

    const { taskId, leaseId } = await claimFirstTask();
    const state = await loadState();

    const request = makeRequest(taskId, leaseId);
    request.workflow_id = state.workflow_id;

    const outcome = await applyPermanentProviderFailure({
      request,
      error: new ProviderError({
        provider: "opencode",
        kind: "authentication",
        retryable: false,
        statusCode: 401,
        message: "invalid api key",
      }),
    });

    assert.equal(outcome.outcome, "failed");

    const reloaded = await loadState();
    const task = reloaded.tasks[0]!;

    assert.equal(task.status, "failed");
    assert.equal(task.lease_id, null);
    assert.equal(task.last_provider_error?.kind, "authentication");
    assert.equal(task.last_provider_error?.status_code, 401);
    assert.match(task.last_error ?? "", /Permanent provider failure/);
    assert.equal(reloaded.status, "failed");

    const history = await loadHistory(reloaded.workflow_id);
    assert.ok(history.some((event) => event.event === "provider_failure"));
  });

  it("records recovery and clears diagnostics when a retried task completes", async () => {
    const state = await loadState();
    const task = state.tasks.find((item) => item.id === "P-AUTH")!;

    const recovered = await maybeRecordProviderRecovery(state, task);

    assert.equal(recovered, true);
    assert.equal(task.last_provider_error, null);
    assert.equal(task.retry_not_before, null);

    const history = await loadHistory(state.workflow_id);
    assert.ok(history.some((event) => event.event === "provider_recovered"));
  });

  it("loads legacy workflow states without retry fields", async () => {
    const legacyState = {
      workflow_id: "legacy-no-retry-fields",
      workflow_type: "feature",
      status: "planned",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_graph: "legacy",
      tasks: [
        {
          id: "OLD-1",
          title: "Old task",
          agent: "backend",
          description: "d",
          dependencies: [],
          acceptance_criteria: ["c"],
          status: "pending",
          attempts: 0,
          started_at: null,
          completed_at: null,
          last_error: null,
          result_file: null,
        },
      ],
    };

    mkdirSync(join(tempRoot, "tasks", "legacy-no-retry-fields"), {
      recursive: true,
    });

    writeFileSync(
      join(tempRoot, "tasks", "legacy-no-retry-fields", "state.json"),
      JSON.stringify(legacyState, null, 2),
      "utf8",
    );

    const loaded = await loadState("legacy-no-retry-fields");

    assert.equal(loaded.workflow_id, "legacy-no-retry-fields");
    assert.equal(loaded.tasks[0]?.status, "pending");
    assert.equal(loaded.tasks[0]?.retry_not_before, undefined);
    assert.equal(loaded.tasks[0]?.last_provider_error, undefined);
  });

  it("keeps retry state intact across save/load round-trips", async () => {
    const raw = JSON.parse(
      readFileSync(
        join(tempRoot, "tasks", "legacy-no-retry-fields", "state.json"),
        "utf8",
      ),
    );

    raw.tasks[0].status = "retry_wait";
    raw.tasks[0].attempts = 2;
    raw.tasks[0].max_attempts = 3;
    raw.tasks[0].retry_not_before = "2026-08-21T17:10:00.000Z";
    raw.tasks[0].last_provider_error = {
      provider: "opencode",
      kind: "timeout",
      message: "request timed out",
      retryable: true,
    };

    writeFileSync(
      join(tempRoot, "tasks", "legacy-no-retry-fields", "state.json"),
      JSON.stringify(raw, null, 2),
      "utf8",
    );

    const reloaded = await loadState("legacy-no-retry-fields");
    const task = reloaded.tasks[0]!;

    assert.equal(task.status, "retry_wait");
    assert.equal(task.retry_not_before, "2026-08-21T17:10:00.000Z");
    assert.equal(task.last_provider_error?.kind, "timeout");
  });
});
