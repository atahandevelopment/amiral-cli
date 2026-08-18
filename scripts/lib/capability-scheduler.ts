import type { AgentName, WorkflowState } from "./types.js";
import type { TeamConfig } from "./team-config.js";

export type CapabilityRouting = {
  mode: "fixed" | "auto";
  required_capabilities?: string[];
  preferred_agents?: AgentName[];
};

export type CapabilityAwareTask = WorkflowState["tasks"][number] & {
  routing?: CapabilityRouting;
};

type AgentCapabilityProfile = {
  agent: AgentName;
  capabilities: string[];
  priority: number;
};

export type RoutingDecision = {
  taskId: string;
  previousAgent: AgentName;
  selectedAgent: AgentName;
  requiredCapabilities: string[];
  matchedCapabilities: string[];
  score: number;
  reason: string;
};

function normalizeCapability(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeCapability).filter(Boolean))];
}

function readAgentProfiles(config: TeamConfig): AgentCapabilityProfile[] {
  const root = config as TeamConfig & {
    agents?: Partial<Record<AgentName, {
      capabilities?: string[];
      routing_priority?: number;
    }>>;
  };

  return Object.entries(root.agents ?? {}).flatMap(([agent, value]) => {
    if (!value) return [];

    return [{
      agent: agent as AgentName,
      capabilities: normalizeList(value.capabilities),
      priority:
        typeof value.routing_priority === "number"
          ? value.routing_priority
          : 0,
    }];
  });
}

function scoreProfile(
  profile: AgentCapabilityProfile,
  required: string[],
  preferredAgents: AgentName[],
) {
  const available = new Set(profile.capabilities);
  const matched = required.filter((capability) => available.has(capability));
  const fullMatch = matched.length === required.length;

  let score = matched.length * 100;

  const preferredIndex = preferredAgents.indexOf(profile.agent);
  if (preferredIndex >= 0) {
    score += Math.max(1, 25 - preferredIndex * 5);
  }

  score += profile.priority;

  return { score, matched, fullMatch };
}

export function selectAgentForTask(
  task: CapabilityAwareTask,
  config: TeamConfig,
): RoutingDecision {
  const routing = task.routing;

  if (!routing || routing.mode === "fixed") {
    return {
      taskId: task.id,
      previousAgent: task.agent,
      selectedAgent: task.agent,
      requiredCapabilities: normalizeList(routing?.required_capabilities),
      matchedCapabilities: [],
      score: 0,
      reason: "Task uses fixed agent routing.",
    };
  }

  const required = normalizeList(routing.required_capabilities);
  const preferredAgents = routing.preferred_agents ?? [];

  if (!required.length) {
    return {
      taskId: task.id,
      previousAgent: task.agent,
      selectedAgent: task.agent,
      requiredCapabilities: [],
      matchedCapabilities: [],
      score: 0,
      reason:
        "Auto routing requested without required capabilities; existing agent kept as safe fallback.",
    };
  }

  const candidates = readAgentProfiles(config)
    .map((profile) => ({
      profile,
      ...scoreProfile(profile, required, preferredAgents),
    }))
    .filter((candidate) => candidate.fullMatch)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.profile.agent.localeCompare(right.profile.agent);
    });

  const winner = candidates[0];

  if (!winner) {
    throw new Error(
      `No agent satisfies all required capabilities for task "${task.id}": ${required.join(", ")}`,
    );
  }

  return {
    taskId: task.id,
    previousAgent: task.agent,
    selectedAgent: winner.profile.agent,
    requiredCapabilities: required,
    matchedCapabilities: winner.matched,
    score: winner.score,
    reason:
      `Selected "${winner.profile.agent}" because it satisfies all required capabilities: ${required.join(", ")}.`,
  };
}

export function routeWorkflowTasks(
  state: WorkflowState,
  config: TeamConfig,
): RoutingDecision[] {
  const decisions: RoutingDecision[] = [];

  for (const task of state.tasks as CapabilityAwareTask[]) {
    if (task.status !== "pending") continue;
    if (!task.routing || task.routing.mode !== "auto") continue;

    const decision = selectAgentForTask(task, config);
    task.agent = decision.selectedAgent;
    decisions.push(decision);
  }

  return decisions;
}
