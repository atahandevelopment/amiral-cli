import type { TeamConfig } from "./team-config.js";

export type ProviderName = "opencode";

export type ProviderCapacity = {
  provider: ProviderName;
  maxConcurrency: number;
};

export function getProviderCapacity(
  config: TeamConfig,
  provider: ProviderName,
): ProviderCapacity {
  const root = config as TeamConfig & {
    providers?: {
      opencode?: {
        max_concurrency?: number;
      };
    };
  };

  const configured =
    root.providers?.[provider]?.max_concurrency;

  return {
    provider,
    maxConcurrency:
      typeof configured === "number" &&
      Number.isFinite(configured) &&
      configured > 0
        ? Math.floor(configured)
        : 1,
  };
}
