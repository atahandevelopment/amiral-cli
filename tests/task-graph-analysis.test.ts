import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SourceTask } from "../scripts/lib/types.js";
import {
  analyzeTaskGraph,
  areDependencyIndependent,
  findConflictDomainWarnings,
  formatTaskGraphAnalysis,
  getTransitiveDependencies,
} from "../scripts/lib/task-graph-analysis.js";

function task(overrides: Partial<SourceTask> & { id: string }): SourceTask {
  return {
    title: overrides.id,
    agent: "backend",
    description: `Description for ${overrides.id}`,
    dependencies: [],
    acceptance_criteria: [`${overrides.id} works`],
    ...overrides,
  };
}

function linearGraph(): SourceTask[] {
  return [
    task({ id: "A" }),
    task({ id: "B", dependencies: ["A"] }),
    task({ id: "C", dependencies: ["B"] }),
    task({ id: "D", dependencies: ["C"] }),
  ];
}

describe("task-graph-analysis", () => {
  it("computes dependency depth as the longest chain in edges", () => {
    const analysis = analyzeTaskGraph(linearGraph());

    assert.equal(analysis.maxDepth, 3);
  });

  it("counts edges, roots and leaves", () => {
    const analysis = analyzeTaskGraph([
      task({ id: "ROOT-1" }),
      task({ id: "ROOT-2" }),
      task({ id: "MID", dependencies: ["ROOT-1", "ROOT-2"] }),
      task({ id: "LEAF", dependencies: ["MID"] }),
    ]);

    assert.equal(analysis.taskCount, 4);
    assert.equal(analysis.edgeCount, 3);
    assert.deepEqual(analysis.rootTaskIds.sort(), ["ROOT-1", "ROOT-2"]);
    assert.deepEqual(analysis.leafTaskIds, ["LEAF"]);
  });

  it("detects parallel roots as level-zero groups", () => {
    const analysis = analyzeTaskGraph([
      task({ id: "DB" }),
      task({ id: "UI" }),
      task({ id: "API", dependencies: ["DB"] }),
      task({ id: "TESTS", dependencies: ["API", "UI"] }),
    ]);

    assert.equal(analysis.parallelGroups.length, 3);
    assert.deepEqual(analysis.parallelGroups[0]!.sort(), ["DB", "UI"]);
    assert.deepEqual(analysis.parallelGroups[1], ["API"]);
    assert.deepEqual(analysis.parallelGroups[2], ["TESTS"]);
    assert.equal(analysis.maxDepth, 2);
  });

  it("warns when dependency-independent tasks share a conflict domain", () => {
    const tasks = [
      task({
        id: "AUTH-API",
        planning: { conflict_domains: ["auth-core"] },
      }),
      task({
        id: "AUTH-REFRESH",
        planning: { conflict_domains: ["auth-core"] },
      }),
    ];

    const warnings = findConflictDomainWarnings(tasks);

    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0]!.message,
      /Tasks AUTH-API and AUTH-REFRESH are dependency-independent but share conflict domain 'auth-core'\./,
    );
  });

  it("does not warn when tasks sharing a conflict domain are ordered by dependencies", () => {
    const tasks = [
      task({
        id: "AUTH-API",
        planning: { conflict_domains: ["auth-core"] },
      }),
      task({
        id: "AUTH-TESTS",
        dependencies: ["AUTH-API"],
        planning: { conflict_domains: ["auth-core"] },
      }),
    ];

    assert.deepEqual(findConflictDomainWarnings(tasks), []);
  });

  it("treats transitive ordering as safe", () => {
    const tasks = [
      task({ id: "A" }),
      task({ id: "B", dependencies: ["A"] }),
      task({ id: "C", dependencies: ["B"] }),
    ];

    assert.deepEqual(getTransitiveDependencies("C", tasks), new Set(["A", "B"]));
    assert.equal(areDependencyIndependent("A", "C", tasks), false);
    assert.equal(areDependencyIndependent("A", "B", tasks), false);
  });

  it("reports tasks without capabilities, high risk and missing criteria", () => {
    const analysis = analyzeTaskGraph([
      task({ id: "NO-CAPS" }),
      task({
        id: "RISKY",
        routing: { mode: "auto", required_capabilities: ["backend/rest-api"] },
        planning: { risk: "high" },
      }),
      task({ id: "NO-CRITERIA", acceptance_criteria: [] }),
    ]);

    assert.deepEqual(analysis.taskIdsWithoutCapabilities.sort(), [
      "NO-CAPS",
      "NO-CRITERIA",
    ]);
    assert.deepEqual(analysis.highRiskTaskIds, ["RISKY"]);
    assert.deepEqual(analysis.taskIdsWithoutAcceptanceCriteria, [
      "NO-CRITERIA",
    ]);
  });

  it("formats a CLI report", () => {
    const report = formatTaskGraphAnalysis(analyzeTaskGraph(linearGraph()));

    assert.match(report, /Tasks: 4/);
    assert.match(report, /Edges: 3/);
    assert.match(report, /Max depth: 3/);
    assert.match(report, /Parallel roots: 1/);
    assert.match(report, /Conflict warnings: 0/);
    assert.match(report, /High-risk tasks: 0/);
  });
});
