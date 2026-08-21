import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizePlannerResult,
  planToTaskGraph,
  validatePlannerPlan,
} from "../scripts/lib/task-graph-planner.js";
import { validateTaskGraphSemantics } from "../scripts/lib/task-graph.js";

const KNOWN_CAPABILITIES = [
  "database/postgresql",
  "database/migrations",
  "backend/authentication",
  "backend/rest-api",
  "frontend/nextjs",
  "frontend/react",
  "frontend/typescript",
];

function validPlan() {
  return normalizePlannerResult({
    goal: "Add JWT authentication",
    summary: "DB, API and UI tasks for JWT auth.",
    workflow_type: "feature",
    tasks: [
      {
        id: "AUTH-DB",
        title: "Create user persistence model",
        agent: "database",
        description: "Create users table and migrations.",
        dependencies: [],
        acceptance_criteria: ["Migration applies"],
        routing: {
          mode: "auto",
          required_capabilities: [
            "database/postgresql",
            "database/migrations",
          ],
          preferred_agents: ["database"],
        },
        planning: {
          priority: "high",
          estimated_complexity: "medium",
          risk: "medium",
          expected_files: ["database/**"],
          conflict_domains: ["database-schema"],
          parallel_group: "foundation",
        },
      },
      {
        id: "AUTH-API",
        title: "Implement login endpoint",
        agent: "backend",
        description: "Implement JWT login endpoint.",
        dependencies: ["AUTH-DB"],
        acceptance_criteria: ["Valid credentials return 200"],
        routing: {
          mode: "auto",
          required_capabilities: [
            "backend/authentication",
            "backend/rest-api",
          ],
        },
        planning: { risk: "high" },
      },
    ],
  });
}

describe("task-graph-planner", () => {
  it("accepts a valid generated DAG with planning metadata", () => {
    const plan = validPlan();

    validatePlannerPlan(plan, { knownCapabilities: KNOWN_CAPABILITIES });

    assert.equal(plan.tasks.length, 2);
    assert.equal(plan.tasks[0]!.planning?.priority, "high");
    assert.equal(plan.tasks[1]!.planning?.risk, "high");
  });

  it("rejects duplicate task ids", () => {
    const plan = validPlan();
    plan.tasks.push({ ...plan.tasks[0]! });

    assert.throws(
      () => validatePlannerPlan(plan, { knownCapabilities: KNOWN_CAPABILITIES }),
      /Duplicate task id/,
    );
  });

  it("rejects unknown dependencies", () => {
    const plan = validPlan();
    plan.tasks[1]!.dependencies = ["AUTH-MISSING"];

    assert.throws(
      () => validatePlannerPlan(plan, { knownCapabilities: KNOWN_CAPABILITIES }),
      /unknown task "AUTH-MISSING"/,
    );
  });

  it("rejects self dependencies", () => {
    const plan = validPlan();
    plan.tasks[0]!.dependencies = ["AUTH-DB"];

    assert.throws(
      () => validatePlannerPlan(plan, { knownCapabilities: KNOWN_CAPABILITIES }),
      /cannot depend on itself/,
    );
  });

  it("rejects dependency cycles", () => {
    const plan = validPlan();
    plan.tasks[0]!.dependencies = ["AUTH-API"];

    assert.throws(
      () => validatePlannerPlan(plan, { knownCapabilities: KNOWN_CAPABILITIES }),
      /Circular dependency detected/,
    );
  });

  it("rejects capabilities that do not exist in team.yaml", () => {
    const plan = validPlan();
    plan.tasks[1]!.routing!.required_capabilities = ["backend/blockchain"];

    assert.throws(
      () => validatePlannerPlan(plan, { knownCapabilities: KNOWN_CAPABILITIES }),
      /unknown capability "backend\/blockchain"/,
    );
  });

  it("rejects reviewer and qa as planned implementation tasks", () => {
    const plan = validPlan();
    plan.tasks[1]!.agent = "reviewer";

    assert.throws(
      () => validatePlannerPlan(plan, { knownCapabilities: KNOWN_CAPABILITIES }),
      /quality gate system/,
    );

    plan.tasks[1]!.agent = "qa";

    assert.throws(
      () => validatePlannerPlan(plan, { knownCapabilities: KNOWN_CAPABILITIES }),
      /quality gate system/,
    );
  });

  it("rejects empty task lists", () => {
    assert.throws(
      () =>
        normalizePlannerResult({
          goal: "g",
          summary: "s",
          tasks: [],
        }),
      /non-empty "tasks" array/,
    );
  });

  it("normalizes missing lists and trims values safely", () => {
    const plan = normalizePlannerResult({
      goal: "  Add search  ",
      summary: "Search feature.",
      tasks: [
        {
          id: "  SEARCH-API ",
          title: "Implement search endpoint",
          agent: "backend",
          description: "Implement the search endpoint.",
          acceptance_criteria: ["", "Endpoint returns results", "  "],
          routing: { mode: "auto", required_capabilities: [" backend/rest-api "] },
          planning: {
            priority: "urgent-that-is-invalid",
            conflict_domains: ["search-index", "", "search-index"],
          },
        },
      ],
    });

    const task = plan.tasks[0]!;
    assert.equal(task.id, "SEARCH-API");
    assert.deepEqual(task.dependencies, []);
    assert.deepEqual(task.acceptance_criteria, ["Endpoint returns results"]);
    assert.deepEqual(task.routing?.required_capabilities, ["backend/rest-api"]);
    // Invalid enum values are dropped during normalization.
    assert.equal(task.planning?.priority, undefined);
    assert.deepEqual(task.planning?.conflict_domains, ["search-index"]);
  });

  it("converts a plan to a canonical task graph preserving metadata", () => {
    const graph = planToTaskGraph(validPlan());

    assert.equal(graph.tasks.length, 2);
    assert.deepEqual(
      graph.tasks[0]!.routing?.required_capabilities,
      KNOWN_CAPABILITIES.slice(0, 2),
    );
    assert.equal(graph.tasks[0]!.planning?.parallel_group, "foundation");
  });

  it("keeps legacy task graphs without routing/planning valid", () => {
    const legacyGraph = {
      tasks: [
        {
          id: "DB-001",
          title: "Create authentication schema",
          agent: "database",
          description: "Create entities.",
          dependencies: [],
          acceptance_criteria: ["Migration succeeds"],
        },
        {
          id: "API-001",
          title: "Implement authentication API",
          agent: "backend",
          description: "Implement endpoints.",
          dependencies: ["DB-001"],
          acceptance_criteria: ["Login works"],
        },
      ],
    };

    assert.doesNotThrow(() =>
      validateTaskGraphSemantics(legacyGraph as never),
    );
  });
});
