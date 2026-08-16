#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

type ContractType =
  | "task-graph"
  | "agent-result"
  | "review-result"
  | "execution-request";

type Task = {
  id: string;
  dependencies: string[];
};

type TaskGraph = {
  tasks: Task[];
};

const ROOT = process.cwd();

const SCHEMA_PATHS = {
  task: resolve(ROOT, ".opencode/schemas/task.schema.json"),

  "agent-result": resolve(ROOT, ".opencode/schemas/agent-result.schema.json"),

  "review-result": resolve(ROOT, ".opencode/schemas/review-result.schema.json"),

  "execution-request": resolve(
    ROOT,
    ".opencode/schemas/execution-request.schema.json",
  ),
} as const;

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function loadJson<T = unknown>(filePath: string): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    fail(
      `Could not read or parse JSON file "${filePath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) {
    return "Unknown schema validation error.";
  }

  return errors
    .map((error) => {
      const path = error.instancePath || "/";
      return `  - ${path}: ${error.message ?? "invalid value"}`;
    })
    .join("\n");
}

function validateWithSchema(
  validator: ValidateFunction,
  value: unknown,
  label: string,
): void {
  if (!validator(value)) {
    fail(
      `${label} failed schema validation:\n${formatAjvErrors(validator.errors)}`,
    );
  }
}

function validateDuplicateTaskIds(tasks: Task[]): void {
  const seen = new Set<string>();

  for (const task of tasks) {
    if (seen.has(task.id)) {
      fail(`Duplicate task id detected: "${task.id}".`);
    }
    seen.add(task.id);
  }
}

function validateTaskDependencies(tasks: Task[]): void {
  const ids = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    const seenDependencies = new Set<string>();

    for (const dependency of task.dependencies) {
      if (dependency === task.id) {
        fail(`Task "${task.id}" cannot depend on itself.`);
      }

      if (!ids.has(dependency)) {
        fail(`Task "${task.id}" depends on unknown task "${dependency}".`);
      }

      if (seenDependencies.has(dependency)) {
        fail(
          `Task "${task.id}" contains duplicate dependency "${dependency}".`,
        );
      }

      seenDependencies.add(dependency);
    }
  }
}

function validateNoCycles(tasks: Task[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (taskId: string): void => {
    if (visited.has(taskId)) {
      return;
    }

    if (visiting.has(taskId)) {
      const cycleStart = stack.indexOf(taskId);
      const cycle = [...stack.slice(cycleStart), taskId];
      fail(`Circular dependency detected: ${cycle.join(" -> ")}`);
    }

    visiting.add(taskId);
    stack.push(taskId);

    const task = byId.get(taskId);

    if (!task) {
      fail(`Internal validation error: task "${taskId}" was not found.`);
    }

    for (const dependency of task.dependencies) {
      visit(dependency);
    }

    stack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) {
    visit(task.id);
  }
}

function validateGraphRules(graph: TaskGraph): void {
  validateDuplicateTaskIds(graph.tasks);
  validateTaskDependencies(graph.tasks);
  validateNoCycles(graph.tasks);
}

function printUsage(): never {
  console.error(
    `
Usage:
  npx tsx scripts/validate-team.ts task-graph <file>
  npx tsx scripts/validate-team.ts agent-result <file>
  npx tsx scripts/validate-team.ts review-result <file>

Examples:
  npx tsx scripts/validate-team.ts task-graph task-graph.example.json
  npx tsx scripts/validate-team.ts agent-result examples/agent-result.example.json
  npx tsx scripts/validate-team.ts review-result examples/review-result.example.json
`.trim(),
  );

  process.exit(2);
}

async function main(): Promise<void> {
  const [type, input] = process.argv.slice(2);

  if (
    !type ||
    !input ||
    ![
      "task-graph",
      "agent-result",
      "review-result",
      "execution-request",
    ].includes(type)
  ) {
    printUsage();
  }

  const contractType = type as ContractType;

  const [
    taskSchema,
    agentResultSchema,
    reviewResultSchema,
    executionRequestSchema,
    value,
  ] = await Promise.all([
    loadJson(SCHEMA_PATHS.task),
    loadJson(SCHEMA_PATHS["agent-result"]),
    loadJson(SCHEMA_PATHS["review-result"]),
    loadJson(SCHEMA_PATHS["execution-request"]),
    loadJson(resolve(ROOT, input)),
  ]);

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  const validateTask = ajv.compile(taskSchema);
  const validateAgentResult = ajv.compile(agentResultSchema);
  const validateReviewResult = ajv.compile(reviewResultSchema);
  const validateExecutionRequest = ajv.compile(executionRequestSchema);

  switch (contractType) {
    case "task-graph": {
      if (
        typeof value !== "object" ||
        value === null ||
        !("tasks" in value) ||
        !Array.isArray((value as TaskGraph).tasks)
      ) {
        fail('Task graph must be an object containing a "tasks" array.');
      }

      const graph = value as TaskGraph;

      if (graph.tasks.length === 0) {
        fail("Task graph must contain at least one task.");
      }

      graph.tasks.forEach((task, index) => {
        validateWithSchema(validateTask, task, `tasks[${index}]`);
      });

      validateGraphRules(graph);

      console.log(`✅ Task graph is valid (${graph.tasks.length} tasks).`);
      return;
    }

    case "agent-result":
      validateWithSchema(validateAgentResult, value, "Agent result");
      console.log("✅ Agent result is valid.");
      return;

    case "review-result":
      validateWithSchema(validateReviewResult, value, "Review result");
      console.log("✅ Review result is valid.");
      return;

    case "execution-request":
      validateWithSchema(validateExecutionRequest, value, "Execution request");

      console.log("✅ Execution request is valid.");
      return;
  }
}

void main();
