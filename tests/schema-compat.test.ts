import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { before, describe, it } from "node:test";

const ROOT = process.cwd();

async function loadSchema(file: string): Promise<object> {
  return JSON.parse(
    await readFile(resolve(ROOT, ".opencode/schemas", file), "utf8"),
  ) as object;
}

const legacyTask = {
  id: "DB-001",
  title: "Create authentication schema",
  agent: "database",
  description: "Create entities.",
  dependencies: [],
  acceptance_criteria: ["Migration succeeds"],
};

const plannedTask = {
  ...legacyTask,
  id: "AUTH-DB",
  routing: {
    mode: "auto",
    required_capabilities: ["database/postgresql"],
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
};

describe("schema backward compatibility", () => {
  let validateTask: ReturnType<Ajv2020["compile"]>;
  let validatePlannerResult: ReturnType<Ajv2020["compile"]>;

  before(async () => {
    const [taskSchema, plannerResultSchema] = await Promise.all([
      loadSchema("task.schema.json"),
      loadSchema("planner-result.schema.json"),
    ]);

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(taskSchema);

    validateTask = ajv.compile(taskSchema);
    validatePlannerResult = ajv.compile(plannerResultSchema);
  });

  it("task schema accepts legacy tasks without routing/planning", () => {
    assert.equal(validateTask(legacyTask), true);
  });

  it("task schema accepts tasks with planning metadata", () => {
    assert.equal(validateTask(plannedTask), true, JSON.stringify(validateTask.errors));
  });

  it("canonical and init template schemas remain byte-identical", async () => {
    const files = (await readdir(resolve(ROOT, ".opencode/schemas"))).filter(file => file.endsWith(".json"));
    for (const file of files) {
      assert.equal(
        await readFile(resolve(ROOT, "templates/init/.opencode/schemas", basename(file)), "utf8"),
        await readFile(resolve(ROOT, ".opencode/schemas", file), "utf8"),
        file,
      );
    }
  });

  it("task schema rejects invalid planning enum values", () => {
    const invalid = {
      ...plannedTask,
      planning: { priority: "urgent" },
    };

    assert.equal(validateTask(invalid), false);
  });

  it("task schema rejects unknown properties", () => {
    const invalid = {
      ...legacyTask,
      unknown_field: true,
    };

    assert.equal(validateTask(invalid), false);
  });

  it("planner result schema accepts a valid plan", () => {
    const plan = {
      goal: "Add JWT authentication",
      summary: "Plan.",
      workflow_type: "feature",
      tasks: [plannedTask],
    };

    assert.equal(
      validatePlannerResult(plan),
      true,
      JSON.stringify(validatePlannerResult.errors),
    );
  });

  it("planner result schema rejects empty task lists", () => {
    const plan = {
      goal: "Add JWT authentication",
      summary: "Plan.",
      tasks: [],
    };

    assert.equal(validatePlannerResult(plan), false);
  });

  it("planner result schema rejects missing goal or summary", () => {
    assert.equal(
      validatePlannerResult({ summary: "s", tasks: [legacyTask] }),
      false,
    );
    assert.equal(
      validatePlannerResult({ goal: "g", tasks: [legacyTask] }),
      false,
    );
  });
});
