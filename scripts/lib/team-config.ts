import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import type { AgentName } from "./types.js";

export type TeamExecutionConfig = {
  max_parallel_agents: number;
  lease_minutes: number;
  max_attempts: number;
  requests_directory: string;
  /**
   * Phase 13: which registered execution provider the scheduler uses.
   * Defaults to "opencode" so existing team.yaml files keep working.
   */
  default_provider: string;
};

export type ProviderRetryConfig = {
  /**
   * Retry budget for transient provider failures. Defaults to
   * execution.max_attempts so old configs behave exactly as before.
   */
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
  jitter: boolean;
};

export type TeamProviderConfig = {
  enabled: boolean;
  max_concurrency: number;
  binary?: string;
  auto_approve?: boolean;
  retry: ProviderRetryConfig;
};

export type AgentDefinition = {
  role?: string;
  skills?: string[];
  model?: string;
  reasoning?: string;
};

/**
 * Raw (optional) shape of a single entry under `providers:` in team.yaml.
 */
export type RawTeamProviderConfig = {
  enabled?: boolean;
  max_concurrency?: number;
  binary?: string;
  auto_approve?: boolean;
  retry?: Partial<ProviderRetryConfig>;
};

/**
 * Legacy root-level provider sections, e.g.:
 *
 *   opencode:
 *     binary: opencode
 *     auto_approve: false
 *
 * They remain supported and are folded into the normalized provider config.
 */
export type LegacyProviderSection = {
  binary?: string;
  auto_approve?: boolean;
};

/**
 * Phase 14 — Optional quality-gate loop configuration.
 */
export type RawQualityConfig = {
  max_review_rounds?: number;
};

export type QualityConfig = {
  max_review_rounds: number;
};

export type TeamConfig = {
  team?: {
    name?: string;
  };
  execution?: Partial<TeamExecutionConfig>;
  agents?: Partial<Record<AgentName, AgentDefinition>>;
  providers?: Record<string, RawTeamProviderConfig>;
  /** Legacy root-level OpenCode section; superseded by providers.opencode. */
  opencode?: LegacyProviderSection;
  /** Phase 14 — optional quality-gate loop settings. */
  quality?: RawQualityConfig;
};

const DEFAULT_EXECUTION: TeamExecutionConfig = {
  max_parallel_agents: 3,
  lease_minutes: 30,
  max_attempts: 3,
  requests_directory: "requests",
  default_provider: "opencode",
};

const DEFAULT_RETRY: ProviderRetryConfig = {
  max_attempts: DEFAULT_EXECUTION.max_attempts,
  base_delay_ms: 2000,
  max_delay_ms: 30000,
  jitter: true,
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
    default_provider:
      typeof execution.default_provider === "string" &&
      execution.default_provider.trim()
        ? execution.default_provider.trim()
        : DEFAULT_EXECUTION.default_provider,
  };
}

/**
 * Resolve the name of the default execution provider.
 * Falls back to "opencode" for backward compatibility.
 */
export function resolveDefaultProviderName(config: TeamConfig): string {
  return resolveExecutionConfig(config).default_provider;
}

function retryPositiveInteger(
  value: unknown,
  fallback: number,
  providerName: string,
  field: string,
): number {
  if (value === undefined) return fallback;

  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(
      `team.yaml: providers.${providerName}.retry.${field} must be a positive integer.`,
    );
  }

  return Number(value);
}

/**
 * Normalize the configuration for one provider into a canonical shape.
 *
 * Backward compatibility rules:
 * - `providers.<name>.binary` / `auto_approve` fall back to the legacy root
 *   `<name>:` section (e.g. `opencode.binary`).
 * - `enabled` defaults to true.
 * - `max_concurrency` defaults to 1 (previous hardcoded behavior).
 * - Retry defaults: max_attempts = execution.max_attempts, base_delay_ms 2000,
 *   max_delay_ms 30000, jitter true.
 */
export function resolveProviderConfig(
  config: TeamConfig,
  providerName: string,
): TeamProviderConfig {
  const raw = config.providers?.[providerName];
  const legacy = (config as Record<string, LegacyProviderSection | undefined>)[
    providerName
  ];

  const binary =
    typeof raw?.binary === "string" && raw.binary.trim()
      ? raw.binary.trim()
      : typeof legacy?.binary === "string" && legacy.binary.trim()
        ? legacy.binary.trim()
        : undefined;

  const autoApprove =
    raw?.auto_approve !== undefined ? raw.auto_approve === true : legacy?.auto_approve === true;

  const execution = resolveExecutionConfig(config);

  const retry: ProviderRetryConfig = {
    max_attempts: retryPositiveInteger(
      raw?.retry?.max_attempts,
      execution.max_attempts,
      providerName,
      "max_attempts",
    ),
    base_delay_ms: retryPositiveInteger(
      raw?.retry?.base_delay_ms,
      DEFAULT_RETRY.base_delay_ms,
      providerName,
      "base_delay_ms",
    ),
    max_delay_ms: retryPositiveInteger(
      raw?.retry?.max_delay_ms,
      DEFAULT_RETRY.max_delay_ms,
      providerName,
      "max_delay_ms",
    ),
    jitter: raw?.retry?.jitter !== undefined ? raw.retry.jitter === true : DEFAULT_RETRY.jitter,
  };

  return {
    enabled: raw?.enabled !== false,
    max_concurrency:
      typeof raw?.max_concurrency === "number" &&
      Number.isFinite(raw.max_concurrency) &&
      raw.max_concurrency > 0
        ? Math.floor(raw.max_concurrency)
        : 1,
    ...(binary ? { binary } : {}),
    ...(raw?.auto_approve !== undefined || legacy?.auto_approve !== undefined
      ? { auto_approve: autoApprove }
      : {}),
    retry,
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

const DEFAULT_QUALITY: QualityConfig = {
  max_review_rounds: 3,
};

/**
 * Phase 14 — Resolve the quality-gate loop configuration.
 *
 * `quality.max_review_rounds` defaults to 3 and must be a positive integer
 * when provided. Additive: team.yaml files without a `quality:` section
 * keep working unchanged.
 */
export function resolveQualityConfig(config: TeamConfig): QualityConfig {
  const value = config.quality?.max_review_rounds;

  if (value === undefined) {
    return { ...DEFAULT_QUALITY };
  }

  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(
      "team.yaml: quality.max_review_rounds must be a positive integer.",
    );
  }

  return { max_review_rounds: Number(value) };
}
