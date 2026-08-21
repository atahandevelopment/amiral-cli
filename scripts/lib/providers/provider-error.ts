/**
 * Phase 13 — Structured provider error model.
 *
 * All provider adapters must convert provider-specific failures into a
 * `ProviderError`. Scheduler and dispatcher code must never inspect
 * provider-specific error strings directly; they branch on
 * `ProviderError.kind` / `ProviderError.retryable` only.
 */

export type ProviderErrorKind =
  | "rate_limit"
  | "unavailable"
  | "timeout"
  | "network"
  | "authentication"
  | "configuration"
  | "protocol"
  | "capacity"
  | "unknown";

export class ProviderError extends Error {
  provider: string;
  kind: ProviderErrorKind;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  raw?: unknown;

  constructor(options: {
    message: string;
    provider: string;
    kind: ProviderErrorKind;
    retryable: boolean;
    statusCode?: number;
    retryAfterMs?: number;
    raw?: unknown;
  }) {
    super(options.message);

    this.name = "ProviderError";
    this.provider = options.provider;
    this.kind = options.kind;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.raw = options.raw;
  }
}

/**
 * Default retryability per error kind. Protocol failures are NOT retried by
 * default: a completed provider run that ignored the result contract is a
 * domain problem, not a transient transport problem.
 */
export const KIND_RETRYABILITY: Record<ProviderErrorKind, boolean> = {
  rate_limit: true,
  unavailable: true,
  timeout: true,
  network: true,
  capacity: true,
  authentication: false,
  configuration: false,
  protocol: false,
  unknown: false,
};

export function isRetryableKind(kind: ProviderErrorKind): boolean {
  return KIND_RETRYABILITY[kind];
}

type ClassificationRule = {
  kind: ProviderErrorKind;
  statusCode?: number;
  patterns: RegExp[];
};

/**
 * Ordered classification rules. First match wins. Rules are matched against
 * combined stderr + stdout text because CLI providers usually report HTTP
 * and socket failures as human-readable text.
 */
const TEXT_RULES: ClassificationRule[] = [
  {
    kind: "rate_limit",
    statusCode: 429,
    patterns: [
      /\b429\b/,
      /rate[_ ]?limit/i,
      /too many requests/i,
      /quota.{0,20}(exceeded|cooldown)/i,
    ],
  },
  {
    kind: "unavailable",
    statusCode: 503,
    patterns: [
      /\b503\b/,
      /service unavailable/i,
      /temporarily unavailable/i,
      /upstream unavailable/i,
      /\b502\b/,
      /bad gateway/i,
      /\b500\b/,
      /internal server error/i,
    ],
  },
  {
    kind: "capacity",
    patterns: [/database is locked/i, /database table is locked/i, /sqlite busy/i, /resource temporarily busy/i],
  },
  {
    kind: "timeout",
    patterns: [
      /etimedout/i,
      /request timed out/i,
      /request timeout/i,
      /operation timed out/i,
      /deadline exceeded/i,
    ],
  },
  {
    kind: "network",
    patterns: [
      /econnreset/i,
      /econnrefused/i,
      /eai_again/i,
      /enotfound/i,
      /econnaborted/i,
      /epipe/i,
      /network error/i,
      /socket hang up/i,
      /temporary failure in name resolution/i,
      /dns/i,
    ],
  },
  {
    kind: "authentication",
    patterns: [
      /\b401\b/,
      /unauthorized/i,
      /invalid api key/i,
      /invalid credentials/i,
      /authentication failed/i,
      /\b403\b/,
      /forbidden/i,
      /permission denied/i,
    ],
  },
  {
    kind: "configuration",
    patterns: [
      /unsupported model/i,
      /unknown model/i,
      /model not found/i,
      /invalid (provider )?configuration/i,
      /invalid config/i,
      /missing (api[_ ]?key|credentials)/i,
      /enoent/i,
      /command not found/i,
      /is not recognized/i,
      /not found.*binary/i,
    ],
  },
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Classify a provider failure from structured status data when available and
 * fall back to output-text pattern matching.
 *
 * Numeric HTTP status codes take precedence over text rules; unknown exit
 * codes with unrecognized text become `unknown` (non-retryable) so that
 * unexpected failures surface instead of silently looping.
 */
export function classifyProviderFailure(input: {
  provider: string;
  message: string;
  exitCode?: number;
  statusCode?: number;
  stderr?: string;
  stdout?: string;
}): ProviderError {
  const { provider } = input;

  const combined = [
    input.message,
    input.stderr ?? "",
    input.stdout ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const detail =
    input.stderr?.trim() || input.stdout?.trim() || input.message || "No process output was captured.";

  // Retry-After hints may accompany any failure kind; parse once and attach
  // to whichever classification wins.
  const retryAfterMatch = combined.match(/retry[- ]after\D{0,10}(\d{1,6})/i);
  const retryAfterMs = retryAfterMatch
    ? Number(retryAfterMatch[1]) * 1000
    : undefined;

  // 1. Explicit structured status code.
  if (typeof input.statusCode === "number") {
    const kind = classifyStatusCode(input.statusCode);
    return new ProviderError({
      message: detail,
      provider,
      kind,
      retryable: isRetryableKind(kind),
      statusCode: input.statusCode,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      raw: { exitCode: input.exitCode },
    });
  }

  // 2. Text rules against provider output.
  for (const rule of TEXT_RULES) {
    if (matchesAny(combined, rule.patterns)) {
      return new ProviderError({
        message: detail,
        provider,
        kind: rule.kind,
        retryable: isRetryableKind(rule.kind),
        statusCode: rule.statusCode,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        raw: { exitCode: input.exitCode },
      });
    }
  }

  if (retryAfterMs !== undefined) {
    return new ProviderError({
      message: detail,
      provider,
      kind: "rate_limit",
      retryable: true,
      retryAfterMs,
      raw: { exitCode: input.exitCode },
    });
  }

  // 3. Unknown non-zero exit.
  return new ProviderError({
    message: detail,
    provider,
    kind: "unknown",
    retryable: isRetryableKind("unknown"),
    raw: { exitCode: input.exitCode },
  });
}

/**
 * Map an HTTP status code to an error kind.
 */
export function classifyStatusCode(status: number): ProviderErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "authentication";
  if (status === 503 || status === 502 || status === 504) return "unavailable";
  if (status >= 500) return "unavailable";
  if (status === 404) return "configuration";
  if (status >= 400) return "protocol";
  return "unknown";
}

/**
 * Human-readable one-line diagnostic used by CLI output and history events.
 */
export function describeProviderError(error: ProviderError): string {
  const parts = [
    `provider: ${error.provider}`,
    `error: ${error.kind}`,
  ];

  if (error.statusCode !== undefined) {
    parts.push(`status: ${error.statusCode}`);
  }

  parts.push(`retryable: ${error.retryable}`);

  return parts.join(", ");
}
