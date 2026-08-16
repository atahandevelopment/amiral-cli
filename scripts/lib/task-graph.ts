import type { RuntimeTask, TaskGraph } from "./types.js";

export function isTaskReady(
  task: RuntimeTask,
  graph: Pick<TaskGraph, "tasks"> | { tasks: RuntimeTask[] },
): boolean {
  if (task.status !== "pending") {
    return false;
  }

  return task.dependencies.every((dependencyId) => {
    const dependency = graph.tasks.find((item) => item.id === dependencyId);
    return "status" in dependency! && dependency.status === "completed";
  });
}

export function findReadyTasks(tasks: RuntimeTask[]): RuntimeTask[] {
  return tasks.filter((task) => isTaskReady(task, { tasks }));
}

export function assertNoDuplicateTaskIds(tasks: TaskGraph["tasks"]): void {
  const seen = new Set<string>();

  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id detected: "${task.id}".`);
    }
    seen.add(task.id);
  }
}

export function assertDependenciesExist(tasks: TaskGraph["tasks"]): void {
  const ids = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    const seen = new Set<string>();

    for (const dependency of task.dependencies) {
      if (dependency === task.id) {
        throw new Error(`Task "${task.id}" cannot depend on itself.`);
      }

      if (!ids.has(dependency)) {
        throw new Error(
          `Task "${task.id}" depends on unknown task "${dependency}".`,
        );
      }

      if (seen.has(dependency)) {
        throw new Error(
          `Task "${task.id}" contains duplicate dependency "${dependency}".`,
        );
      }

      seen.add(dependency);
    }
  }
}

export function assertNoDependencyCycles(tasks: TaskGraph["tasks"]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;

    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId);
      const cycle = [...stack.slice(start), taskId];
      throw new Error(`Circular dependency detected: ${cycle.join(" -> ")}`);
    }

    visiting.add(taskId);
    stack.push(taskId);

    const task = byId.get(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found during graph validation.`);
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

export function validateTaskGraphSemantics(graph: TaskGraph): void {
  if (!Array.isArray(graph.tasks) || graph.tasks.length === 0) {
    throw new Error("Task graph must contain at least one task.");
  }

  assertNoDuplicateTaskIds(graph.tasks);
  assertDependenciesExist(graph.tasks);
  assertNoDependencyCycles(graph.tasks);
}
