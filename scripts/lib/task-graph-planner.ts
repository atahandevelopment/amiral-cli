import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  AgentName,
  SourceTask,
  TaskGraph,
  TaskPlanningMetadata,
  WorkflowType,
} from "./types.js";
import { validateTaskGraphSemantics } from "./task-graph.js";
import type { TeamConfig } from "./team-config.js";
import { getKnownCapabilities } from "./capability-scheduler.js";
import { validateContract } from "./contract-validator.js";

/**
 * Structured Planner output contract (Phase 12).
 *
 * The Planner produces a Task Graph Plan; Amiral normalizes, validates and
 * converts it into a canonical TaskGraph that the existing workflow runtime
 * can execute without any changes.
 */
export type TaskGraphPlan = {
  goal: string;
  summary: string;
  workflow_type?: WorkflowType;
  tasks: SourceTask[];
};

export type PlanValidationOptions = {
  /**
   * Capabilities that exist in team.yaml. When omitted, capability validation
   * is skipped so the validator stays usable for graphs that intentionally
   * rely on fixed routing only.
   */
  knownCapabilities?: string[];
};

/**
 * Reviewer and QA are quality gates handled by the existing Phase 10 system.
 * They must never be planned as normal implementation tasks.
 */
const GATE_AGENTS: readonly AgentName[] = ["reviewer", "qa"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function normalizePlanning(value: unknown): TaskPlanningMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const planning: TaskPlanningMetadata = {};

  if (
    value.priority === "low" ||
    value.priority === "normal" ||
    value.priority === "high" ||
    value.priority === "critical"
  ) {
    planning.priority = value.priority;
  }

  if (
    value.estimated_complexity === "small" ||
    value.estimated_complexity === "medium" ||
    value.estimated_complexity === "large"
  ) {
    planning.estimated_complexity = value.estimated_complexity;
  }

  if (
    value.risk === "low" ||
    value.risk === "medium" ||
    value.risk === "high"
  ) {
    planning.risk = value.risk;
  }

  const expectedFiles = normalizeStringList(value.expected_files);
  if (expectedFiles.length) {
    planning.expected_files = expectedFiles;
  }

  const conflictDomains = normalizeStringList(value.conflict_domains);
  if (conflictDomains.length) {
    planning.conflict_domains = conflictDomains;
  }

  if (
    typeof value.parallel_group === "string" &&
    value.parallel_group.trim()
  ) {
    planning.parallel_group = value.parallel_group.trim();
  }

  return Object.keys(planning).length ? planning : undefined;
}

function normalizeRouting(value: unknown): SourceTask["routing"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const mode = value.mode === "fixed" ? "fixed" : "auto";
  const requiredCapabilities = normalizeStringList(
    value.required_capabilities,
  );
  const preferredAgents = normalizeStringList(value.preferred_agents);

  const routing: SourceTask["routing"] = { mode };

  if (requiredCapabilities.length) {
    routing.required_capabilities = requiredCapabilities;
  }

  if (preferredAgents.length) {
    routing.preferred_agents = preferredAgents as AgentName[];
  }

  return routing;
}

function normalizeTask(raw: unknown): SourceTask {
  if (!isRecord(raw)) {
    throw new Error("Planner produced a task that is not an object.");
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const agent =
    typeof raw.agent === "string"
      ? (raw.agent.trim() as AgentName)
      : ("" as AgentName);
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";

  if (!id) {
    throw new Error("Planner produced a task without an id.");
  }

  if (!title) {
    throw new Error(`Task "${id}" is missing a title.`);
  }

  if (!agent) {
    throw new Error(`Task "${id}" is missing an agent.`);
  }

  if (!description) {
    throw new Error(`Task "${id}" is missing a description.`);
  }

  const task: SourceTask = {
    id,
    title,
    agent,
    description,
    dependencies: normalizeStringList(raw.dependencies),
    acceptance_criteria: normalizeStringList(raw.acceptance_criteria),
  };

  const routing = normalizeRouting(raw.routing);
  if (routing) {
    task.routing = routing;
  }

  const planning = normalizePlanning(raw.planning);
  if (planning) {
    task.planning = planning;
  }

  return task;
}

/**
 * Apply small, safe schema fixes to a raw planner result:
 * - trim strings
 * - default missing dependency / acceptance criteria lists to empty arrays
 * - drop empty or duplicate list entries
 * - keep only known planning/routing fields
 *
 * Anything that cannot be repaired safely must fail later validation.
 */
export function normalizePlannerResult(raw: unknown): TaskGraphPlan {
  if (!isRecord(raw)) {
    throw new Error("Planner result must be a JSON object.");
  }

  const goal = typeof raw.goal === "string" ? raw.goal.trim() : "";
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";

  if (!goal) {
    throw new Error('Planner result is missing a "goal".');
  }

  if (!summary) {
    throw new Error('Planner result is missing a "summary".');
  }

  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) {
    throw new Error('Planner result must contain a non-empty "tasks" array.');
  }

  const plan: TaskGraphPlan = {
    goal,
    summary,
    tasks: raw.tasks.map(normalizeTask),
  };

  if (
    raw.workflow_type === "feature" ||
    raw.workflow_type === "bugfix" ||
    raw.workflow_type === "refactor"
  ) {
    plan.workflow_type = raw.workflow_type;
  }

  return plan;
}

/**
 * Validate a normalized Task Graph Plan (semantic rules only, no file I/O).
 *
 * Reuses the existing semantic task graph validators (duplicate ids, unknown
 * dependencies, self dependencies, cycles) and adds Phase 12 rules:
 * - required capabilities must exist in team.yaml
 * - reviewer/qa are quality gates handled by the existing quality gate system
 *   and must not be planned as normal implementation tasks
 */
export function validatePlannerPlan(
  plan: TaskGraphPlan,
  options: PlanValidationOptions = {},
): void {
  validateTaskGraphSemantics({ tasks: plan.tasks });

  for (const task of plan.tasks) {
    if (GATE_AGENTS.includes(task.agent)) {
      throw new Error(
        `Task "${task.id}" uses agent "${task.agent}". ` +
          `Review and QA are quality gates handled by the existing quality gate system ` +
          `and must not be planned as implementation tasks.`,
      );
    }
  }

  if (options.knownCapabilities !== undefined) {
    const knownCapabilities = new Set(
      options.knownCapabilities.map((capability) =>
        capability.trim().toLowerCase(),
      ),
    );

    for (const task of plan.tasks) {
      const required = task.routing?.required_capabilities ?? [];

      for (const capability of required) {
        if (!knownCapabilities.has(capability.trim().toLowerCase())) {
          throw new Error(
            `Task "${task.id}" requires unknown capability "${capability}". ` +
              `Only capabilities defined in team.yaml may be used.`,
          );
        }
      }
    }
  }
}

/**
 * Full validation pipeline used by CLIs: JSON schema + semantics +
 * capability awareness.
 */
export async function validatePlannerPlanWithSchema(
  plan: TaskGraphPlan,
  options: PlanValidationOptions = {},
): Promise<void> {
  await validateContract("planner-result", plan);
  validatePlannerPlan(plan, options);
}

/**
 * Convert a validated plan into the canonical TaskGraph shape used by the
 * existing workflow runtime. Routing and planning metadata are preserved.
 */
export function planToTaskGraph(plan: TaskGraphPlan): TaskGraph {
  return {
    tasks: plan.tasks.map((task) => ({ ...task })),
  };
}

/**
 * Load a plan file or a plain task graph file and return the canonical
 * TaskGraph. Plain graphs (without goal/summary) stay backward compatible and
 * only receive semantic validation.
 */
export async function loadTaskGraphFromPlanFile(
  file: string,
  options: PlanValidationOptions & { teamConfig?: TeamConfig } = {},
): Promise<{ graph: TaskGraph; plan: TaskGraphPlan | null }> {
  const absolute = resolve(process.cwd(), file);

  const raw: unknown = JSON.parse(await readFile(absolute, "utf8"));

  if (!isRecord(raw) || !Array.isArray(raw.tasks)) {
    throw new Error(`Plan file "${file}" must contain a "tasks" array.`);
  }

  const isPlan = typeof raw.goal === "string";

  if (!isPlan) {
    const graph = raw as unknown as TaskGraph;
    validateTaskGraphSemantics(graph);
    return { graph, plan: null };
  }

  const plan = normalizePlannerResult(raw);

  const knownCapabilities =
    options.knownCapabilities ??
    (options.teamConfig
      ? getKnownCapabilities(options.teamConfig)
      : undefined);

  await validatePlannerPlanWithSchema(plan, {
    ...(knownCapabilities ? { knownCapabilities } : {}),
  });

  return { graph: planToTaskGraph(plan), plan };
}

/**
 * Build the planner prompt. The prompt embeds the actual agents and
 * capabilities from team.yaml so the Planner can only use real values.
 */
export function buildPlannerPrompt(
  originalRequest: string,
  teamConfig: TeamConfig,
  workflowType: WorkflowType,
): string {
  const agentLines = buildAgentCapabilityLines(teamConfig);
  const knownCapabilities = getKnownCapabilities(teamConfig);

  return `
# Amiral Intelligent Task Graph Planning

You are the Amiral machine planning protocol agent.

Produce a Task Graph Plan for the following user request.

## Workflow Type

${workflowType}

## Original User Request (Authoritative, Verbatim)

${originalRequest}

## Available Agents and Capabilities

These are the ONLY agents and capabilities that exist. Do not invent others.

${agentLines.join("\n\n")}

All valid capability identifiers:

${knownCapabilities.map((capability) => `- ${capability}`).join("\n")}

## Planning Rules

1. Prefer the smallest useful number of tasks.
2. Do not create one task per file.
3. Do not over-decompose trivial work.
4. Each task must have a concrete engineering outcome.
5. Acceptance criteria must be testable.
6. Dependencies must represent real blocking relationships only.
7. Independent tasks must remain dependency-free so they can execute in parallel.
8. Reviewer and QA must NOT appear as tasks. Review and QA are quality gates handled by the existing Amiral quality gate system.
9. Use capability routing ("routing": {"mode": "auto", "required_capabilities": [...]}) instead of hard-coding agents whenever possible.
10. Use "preferred_agents" only as a hint.
11. Only use capabilities from the list above.
12. Follow the existing repository architecture and conventions. Inspect the repository before planning.
13. Identify likely conflict domains in "planning.conflict_domains" when two tasks could touch overlapping areas.
14. Do not create tasks that modify workflow state files.
15. Avoid circular or artificial dependencies.
16. The supplied workflow type is authoritative, as is the complete original user request. Never replace the request with a derived title or summary. If it is underspecified, make reasonable engineering assumptions and produce an actionable plan consistent with that workflow type; do not ask for clarification.

## Required Output

Respond with ONLY a single JSON object matching exactly this structure and nothing else:

\`\`\`json
{
  "goal": "...",
  "summary": "Short plan summary",
  "workflow_type": "${workflowType}",
  "tasks": [
    {
      "id": "PREFIX-001",
      "title": "Concrete engineering outcome",
      "agent": "backend",
      "description": "What the implementing agent must do",
      "dependencies": [],
      "acceptance_criteria": ["Testable criterion"],
      "routing": {
        "mode": "auto",
        "required_capabilities": ["backend/rest-api"],
        "preferred_agents": []
      },
      "planning": {
        "priority": "high",
        "estimated_complexity": "medium",
        "risk": "medium",
        "expected_files": ["src/**"],
        "conflict_domains": ["auth-core"],
        "parallel_group": "foundation"
      }
    }
  ]
}
\`\`\`

All "planning" fields are optional. All other task fields are required except "routing", which may be omitted for fixed-agent work.

Do not wrap the JSON in explanatory prose. Do not add commentary before or after the JSON.
`.trim();
}

function buildAgentCapabilityLines(config: TeamConfig): string[] {
  const root = config as TeamConfig & {
    agents?: Partial<
      Record<AgentName, { capabilities?: unknown; skills?: unknown }>
    >;
  };

  const agents = root.agents ?? {};

  return Object.entries(agents).map(([agent, definition]) => {
    const capabilities = Array.isArray(definition?.capabilities)
      ? definition.capabilities.filter(
          (capability): capability is string =>
            typeof capability === "string",
        )
      : [];

    return [
      `### ${agent}`,
      ...(capabilities.length
        ? capabilities.map((capability) => `- ${capability}`)
        : ["- (no capabilities declared)"]),
    ].join("\n");
  });
}
