import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import type { AgentName } from "./types.js";

export type TeamExecutionConfig = {
  max_parallel_agents: number;
  lease_minutes: number;
  max_attempts: number;
  requests_directory: string;
};

export type AgentDefinition = {
  role?: string;
  skills?: string[];
  model?: string;
  reasoning?: string;
};

export type TeamConfig = {
  team?: {
    name?: string;
  };
  execution?: Partial<TeamExecutionConfig>;
  agents?: Partial<Record<AgentName, AgentDefinition>>;
};

const DEFAULT_EXECUTION: TeamExecutionConfig = {
  max_parallel_agents: 3,
  lease_minutes: 30,
  max_attempts: 3,
  requests_directory: "requests",
};

function positiveInteger(
  value: unknown,
  fallback: number,
  field: string,
): number {
  if (value === undefined) return fallback;

  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`team.yaml: execution.${field} must be a positive integer.`);
  }

  return Number(value);
}

export async function loadTeamConfig(
  file = "team.yaml",
): Promise<TeamConfig> {
  const path = resolve(process.cwd(), file);
  const source = await readFile(path, "utf8");
  const parsed = YAML.parse(source) as TeamConfig | null;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("team.yaml must contain a YAML object.");
  }

  return parsed;
}

export function resolveExecutionConfig(
  config: TeamConfig,
): TeamExecutionConfig {
  const execution = config.execution ?? {};

  const requestsDirectory =
    typeof execution.requests_directory === "string" &&
    execution.requests_directory.trim()
      ? execution.requests_directory.trim()
      : DEFAULT_EXECUTION.requests_directory;

  return {
    max_parallel_agents: positiveInteger(
      execution.max_parallel_agents,
      DEFAULT_EXECUTION.max_parallel_agents,
      "max_parallel_agents",
    ),
    lease_minutes: positiveInteger(
      execution.lease_minutes,
      DEFAULT_EXECUTION.lease_minutes,
      "lease_minutes",
    ),
    max_attempts: positiveInteger(
      execution.max_attempts,
      DEFAULT_EXECUTION.max_attempts,
      "max_attempts",
    ),
    requests_directory: requestsDirectory,
  };
}

export function getAgentSkills(
  config: TeamConfig,
  agent: AgentName,
): string[] {
  const skills = config.agents?.[agent]?.skills;
  return Array.isArray(skills)
    ? skills.filter((skill): skill is string => typeof skill === "string")
    : [];
}
