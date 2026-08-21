import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * Workflow creation resolves runtime paths from process.cwd() at module load
 * time. The modules are therefore imported dynamically AFTER chdir into a
 * temporary directory so the test never touches the real tasks/ directory.
 */
describe("workflow-create", () => {
  let tempRoot: string;
  let previousCwd: string;

  let createWorkflowFromGraph: typeof import("../scripts/lib/workflow-create.js").createWorkflowFromGraph;
  let toRuntimeTasks: typeof import("../scripts/lib/workflow-create.js").toRuntimeTasks;

  const graph = {
    tasks: [
      {
        id: "AUTH-DB",
        title: "Create user persistence model",
        agent: "database" as const,
        description: "Create users table and migrations.",
        dependencies: [] as string[],
        acceptance_criteria: ["Migration applies"],
        routing: {
          mode: "auto" as const,
          required_capabilities: ["database/postgresql"],
          preferred_agents: ["database" as const],
        },
        planning: {
          priority: "high" as const,
          risk: "medium" as const,
          conflict_domains: ["database-schema"],
          parallel_group: "foundation",
        },
      },
      {
        id: "AUTH-API",
        title: "Implement login endpoint",
        agent: "backend" as const,
        description: "Implement JWT login endpoint.",
        dependencies: ["AUTH-DB"],
        acceptance_criteria: ["Valid credentials return 200"],
      },
    ],
  };

  before(() => {
    previousCwd = process.cwd();
    tempRoot = mkdtempSync(join(tmpdir(), "amiral-phase12-"));
    process.chdir(tempRoot);

    // Dynamic import AFTER chdir so workflow-store ROOT points at tempRoot.
    return import("../scripts/lib/workflow-create.js").then((mod) => {
      createWorkflowFromGraph = mod.createWorkflowFromGraph;
      toRuntimeTasks = mod.toRuntimeTasks;
    });
  });

  after(() => {
    process.chdir(previousCwd);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("maps source tasks to runtime tasks preserving routing/planning", () => {
    const runtimeTasks = toRuntimeTasks(graph);

    assert.equal(runtimeTasks.length, 2);
    assert.equal(runtimeTasks[0]!.status, "pending");
    assert.deepEqual(
      runtimeTasks[0]!.routing?.required_capabilities,
      ["database/postgresql"],
    );
    assert.equal(runtimeTasks[0]!.planning?.priority, "high");
    assert.equal(runtimeTasks[1]!.routing, undefined);
    assert.equal(runtimeTasks[1]!.planning, undefined);
  });

  it("creates a workflow whose state preserves routing and planning metadata", async () => {
    const state = await createWorkflowFromGraph({
      type: "feature",
      graph,
      graphSource: "plans/test/task-graph.json",
      name: "phase12-test",
    });

    assert.match(state.workflow_id, /^phase12-test-/);
    assert.equal(state.status, "planned");

    const persisted = JSON.parse(
      readFileSync(join("tasks", state.workflow_id, "state.json"), "utf8"),
    );

    assert.equal(persisted.source_graph, "plans/test/task-graph.json");
    assert.equal(persisted.tasks.length, 2);
    assert.deepEqual(
      persisted.tasks[0].routing.required_capabilities,
      ["database/postgresql"],
    );
    assert.equal(persisted.tasks[0].planning.parallel_group, "foundation");
    assert.equal(persisted.tasks[0].status, "pending");

    const persistedGraph = JSON.parse(
      readFileSync(join("tasks", state.workflow_id, "task-graph.json"), "utf8"),
    );
    assert.equal(persistedGraph.tasks[0].planning.risk, "medium");

    const history = JSON.parse(
      readFileSync(join("tasks", state.workflow_id, "history.json"), "utf8"),
    );
    assert.equal(history[0].event, "workflow_created");

    const active = readFileSync(
      join("tasks", ".active-workflow"),
      "utf8",
    ).trim();
    assert.equal(active, state.workflow_id);
  });

  it("rejects invalid graphs before creating a workflow", async () => {
    await assert.rejects(
      () =>
        createWorkflowFromGraph({
          type: "feature",
          graph: {
            tasks: [
              {
                ...graph.tasks[0]!,
                dependencies: ["AUTH-API"],
              },
              graph.tasks[1],
            ],
          },
          graphSource: "inline",
        }),
      /Circular dependency detected/,
    );

    await assert.rejects(
      () =>
        createWorkflowFromGraph({
          type: "feature",
          graph: { tasks: [graph.tasks[0]!, graph.tasks[0]!] },
          graphSource: "inline",
        }),
      /Duplicate task id/,
    );
  });
});
