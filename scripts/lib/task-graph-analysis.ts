import type { SourceTask } from "./types.js";

/**
 * Phase 12 graph quality analysis.
 *
 * Pure, reusable analysis over any task list (planner output or runtime
 * tasks). The scheduler may later reuse the conflict helpers to avoid
 * concurrent dispatch of tasks that share a conflict domain.
 */

export type ConflictDomainWarning = {
  firstTaskId: string;
  secondTaskId: string;
  domain: string;
  message: string;
};

export type TaskGraphAnalysis = {
  taskCount: number;
  edgeCount: number;
  rootTaskIds: string[];
  leafTaskIds: string[];
  /** Longest dependency chain, counted in edges. */
  maxDepth: number;
  /**
   * Groups of task ids that may run in parallel. Tasks are grouped by their
   * dependency level: every task in a group has the same maximum dependency
   * distance from a root task.
   */
  parallelGroups: string[][];
  conflictWarnings: ConflictDomainWarning[];
  taskIdsWithoutCapabilities: string[];
  highRiskTaskIds: string[];
  taskIdsWithoutAcceptanceCriteria: string[];
};

/** Transitive dependencies of a task (its full ancestor set). */
export function getTransitiveDependencies(
  taskId: string,
  tasks: Pick<SourceTask, "id" | "dependencies">[],
): Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ancestors = new Set<string>();
  const stack = [...(byId.get(taskId)?.dependencies ?? [])];

  while (stack.length) {
    const current = stack.pop()!;

    if (ancestors.has(current)) {
      continue;
    }

    ancestors.add(current);

    const parent = byId.get(current);
    if (parent) {
      stack.push(...parent.dependencies);
    }
  }

  return ancestors;
}

/**
 * Two tasks are dependency-independent when neither can reach the other
 * through the dependency graph. Such tasks may be scheduled concurrently.
 */
export function areDependencyIndependent(
  taskAId: string,
  taskBId: string,
  tasks: Pick<SourceTask, "id" | "dependencies">[],
): boolean {
  const ancestorsOfA = getTransitiveDependencies(taskAId, tasks);
  const ancestorsOfB = getTransitiveDependencies(taskBId, tasks);

  return (
    !ancestorsOfA.has(taskBId) &&
    !ancestorsOfB.has(taskAId) &&
    taskAId !== taskBId
  );
}

function getSharedConflictDomains(
  first: SourceTask,
  second: SourceTask,
): string[] {
  const domainsOfFirst = new Set(
    (first.planning?.conflict_domains ?? []).map((domain) =>
      domain.trim().toLowerCase(),
    ),
  );

  const shared: string[] = [];

  for (const domain of second.planning?.conflict_domains ?? []) {
    if (domainsOfFirst.has(domain.trim().toLowerCase())) {
      shared.push(domain.trim());
    }
  }

  return shared;
}

/**
 * Detect pairs of dependency-independent tasks that share a conflict domain.
 *
 * This is intentionally a WARNING, not a validation error: Amiral does not
 * invent dependencies automatically. The scheduler can use this information
 * later to serialize risky pairs.
 */
export function findConflictDomainWarnings(
  tasks: SourceTask[],
): ConflictDomainWarning[] {
  const warnings: ConflictDomainWarning[] = [];

  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const first = tasks[i]!;
      const second = tasks[j]!;

      if (!areDependencyIndependent(first.id, second.id, tasks)) {
        continue;
      }

      for (const domain of getSharedConflictDomains(first, second)) {
        warnings.push({
          firstTaskId: first.id,
          secondTaskId: second.id,
          domain,
          message:
            `Tasks ${first.id} and ${second.id} are dependency-independent ` +
            `but share conflict domain '${domain}'.`,
        });
      }
    }
  }

  return warnings;
}

function computeDependencyDepth(
  taskId: string,
  byId: Map<string, SourceTask>,
  cache: Map<string, number>,
): number {
  const cached = cache.get(taskId);
  if (cached !== undefined) {
    return cached;
  }

  const task = byId.get(taskId);

  if (!task || task.dependencies.length === 0) {
    cache.set(taskId, 0);
    return 0;
  }

  let depth = 0;

  for (const dependency of task.dependencies) {
    depth = Math.max(
      depth,
      computeDependencyDepth(dependency, byId, cache) + 1,
    );
  }

  cache.set(taskId, depth);
  return depth;
}

/**
 * Analyze a task list and report structure and quality metrics.
 */
export function analyzeTaskGraph(tasks: SourceTask[]): TaskGraphAnalysis {
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const depths = new Map<string, number>();
  for (const task of tasks) {
    depths.set(
      task.id,
      computeDependencyDepth(task.id, byId, depths),
    );
  }

  const dependentOn = new Map<string, Set<string>>();
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      const dependents = dependentOn.get(dependency) ?? new Set<string>();
      dependents.add(task.id);
      dependentOn.set(dependency, dependents);
    }
  }

  const rootTaskIds = tasks
    .filter((task) => task.dependencies.length === 0)
    .map((task) => task.id);

  const leafTaskIds = tasks
    .filter((task) => (dependentOn.get(task.id)?.size ?? 0) === 0)
    .map((task) => task.id);

  const maxDepth = tasks.reduce(
    (max, task) => Math.max(max, depths.get(task.id) ?? 0),
    0,
  );

  const parallelGroups: string[][] = [];
  for (const task of tasks) {
    const level = depths.get(task.id) ?? 0;
    parallelGroups[level] ??= [];
    parallelGroups[level]!.push(task.id);
  }

  const conflictWarnings = findConflictDomainWarnings(tasks);

  const taskIdsWithoutCapabilities = tasks
    .filter(
      (task) => !task.routing?.required_capabilities?.length,
    )
    .map((task) => task.id);

  const highRiskTaskIds = tasks
    .filter((task) => task.planning?.risk === "high")
    .map((task) => task.id);

  const taskIdsWithoutAcceptanceCriteria = tasks
    .filter((task) => task.acceptance_criteria.length === 0)
    .map((task) => task.id);

  return {
    taskCount: tasks.length,
    edgeCount: tasks.reduce(
      (sum, task) => sum + new Set(task.dependencies).size,
      0,
    ),
    rootTaskIds,
    leafTaskIds,
    maxDepth,
    parallelGroups,
    conflictWarnings,
    taskIdsWithoutCapabilities,
    highRiskTaskIds,
    taskIdsWithoutAcceptanceCriteria,
  };
}

/**
 * Format an analysis report for CLI output.
 */
export function formatTaskGraphAnalysis(
  analysis: TaskGraphAnalysis,
): string {
  const lines: string[] = [];

  lines.push("Graph analysis:");
  lines.push(`Tasks: ${analysis.taskCount}`);
  lines.push(`Edges: ${analysis.edgeCount}`);
  lines.push(`Max depth: ${analysis.maxDepth}`);
  lines.push(`Parallel roots: ${analysis.rootTaskIds.length}`);
  lines.push(`Conflict warnings: ${analysis.conflictWarnings.length}`);
  lines.push(`High-risk tasks: ${analysis.highRiskTaskIds.length}`);

  if (analysis.leafTaskIds.length) {
    lines.push(`Leaf tasks: ${analysis.leafTaskIds.join(", ")}`);
  }

  if (analysis.parallelGroups.length) {
    lines.push("Parallelizable groups:");
    analysis.parallelGroups.forEach((group, index) => {
      lines.push(`  Level ${index}: ${group.join(", ")}`);
    });
  }

  if (analysis.conflictWarnings.length) {
    lines.push("Conflict warnings:");
    for (const warning of analysis.conflictWarnings) {
      lines.push(`  ⚠ ${warning.message}`);
    }
  }

  if (analysis.taskIdsWithoutCapabilities.length) {
    lines.push(
      `Tasks without required capabilities: ` +
        `${analysis.taskIdsWithoutCapabilities.join(", ")}`,
    );
  }

  if (analysis.taskIdsWithoutAcceptanceCriteria.length) {
    lines.push(
      `Tasks without acceptance criteria: ` +
        `${analysis.taskIdsWithoutAcceptanceCriteria.join(", ")}`,
    );
  }

  return lines.join("\n");
}
