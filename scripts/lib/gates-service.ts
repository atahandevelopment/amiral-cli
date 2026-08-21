/**
 * Phase 14 — Reusable quality-gate service.
 *
 * Extracted from scripts/run-quality-gate.ts so a future CLI can run the
 * review and QA gates without spawning the script. Semantics are unchanged:
 *
 *   - prompts are written under <integration worktree>/.amiral/gates/
 *   - results are normalized and validated against the "quality-gate"
 *     contract, then written back canonically
 *   - a QA PASS marks the workflow completed (existing side effect)
 *
 * The prompt transport is injectable so tests can substitute a fake
 * provider. Progress lines are emitted through the optional `onEvent`
 * callback. This module never writes to the console and never exits.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { TeamConfig } from "./team-config.js";
import {
  loadTeamConfig,
  resolveDefaultProviderName,
} from "./team-config.js";
import { validateContract } from "./contract-validator.js";
import {
  loadJson,
  loadState,
  saveState,
  writeJson,
} from "./workflow-store.js";
import { createIntegrationWorkspace } from "./integration.js";
import { getPromptTransport } from "./providers/provider-registry.js";
import type {
  PromptTransportInput,
  PromptTransportOutput,
  PromptTransportProvider,
} from "./providers/provider.js";
import {
  classifyProviderFailure,
  describeProviderError,
} from "./providers/provider-error.js";

export type GateType = "review" | "qa";

export type ReviewVerdict = "PASS" | "CHANGES_REQUESTED" | "BLOCKED";

export type QaVerdict = "PASS" | "FAIL" | "BLOCKED";

export type FindingSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "SUGGESTION";

export type QualityGateFinding = {
  severity: FindingSeverity;
  file?: string;
  line?: number;
  issue: string;
  recommendation?: string;
};

type QualityGateResult = {
  workflow_id: string;
  gate: GateType;
  status: "PASS" | "CHANGES_REQUESTED" | "FAIL" | "BLOCKED";
  summary: string;
  findings: QualityGateFinding[];
};

type RawQualityGateResult = Omit<QualityGateResult, "findings"> & {
  findings?: Array<Record<string, unknown>>;
};

function normalizeSeverity(value: unknown): FindingSeverity {
  if (
    value === "CRITICAL" ||
    value === "HIGH" ||
    value === "MEDIUM" ||
    value === "LOW" ||
    value === "SUGGESTION"
  ) {
    return value;
  }

  return "MEDIUM";
}

function normalizeQualityGateResult(
  value: RawQualityGateResult,
): QualityGateResult {
  const findings = Array.isArray(value.findings)
    ? value.findings.map((finding): QualityGateFinding => {
        const issue =
          typeof finding.issue === "string"
            ? finding.issue
            : typeof finding.title === "string"
              ? finding.title
              : typeof finding.description === "string"
                ? finding.description
                : "Reviewer reported an unspecified issue.";

        const file =
          typeof finding.file === "string"
            ? finding.file
            : typeof finding.path === "string"
              ? finding.path
              : undefined;

        const line =
          typeof finding.line === "number" ? finding.line : undefined;

        const recommendation =
          typeof finding.recommendation === "string"
            ? finding.recommendation
            : typeof finding.suggestion === "string"
              ? finding.suggestion
              : typeof finding.fix === "string"
                ? finding.fix
                : undefined;

        return {
          severity: normalizeSeverity(finding.severity),
          issue,
          ...(file ? { file } : {}),
          ...(line ? { line } : {}),
          ...(recommendation ? { recommendation } : {}),
        };
      })
    : [];

  return {
    workflow_id: value.workflow_id,
    gate: value.gate,
    status: value.status,
    summary: value.summary,
    findings,
  };
}

export function buildGatePrompt(
  workflowId: string,
  gate: GateType,
  resultFile: string,
): string {
  if (gate === "review") {
    return `
# Amiral Code Review Gate

Review the integrated implementation for workflow:

${workflowId}

You are the Reviewer.

Inspect the current integration worktree and relevant repository context.

Check:

- correctness
- architecture
- maintainability
- security
- performance
- error handling
- testing
- duplication
- unnecessary complexity
- regressions

Do not implement fixes.

Write the result JSON to exactly:

${resultFile}

The result MUST use exactly this structure:

{
  "workflow_id": "${workflowId}",
  "gate": "review",
  "status": "PASS",
  "summary": "Short review summary",
  "findings": [
    {
      "severity": "HIGH",
      "issue": "Description of the issue",
      "file": "optional/path/to/file.ts",
      "line": 42,
      "recommendation": "Recommended fix"
    }
  ]
}

Allowed review statuses:

- PASS
- CHANGES_REQUESTED
- BLOCKED

Allowed finding severity values:

- CRITICAL
- HIGH
- MEDIUM
- LOW
- SUGGESTION

IMPORTANT:

Every finding MUST use only these keys:

- severity
- issue
- file
- line
- recommendation

Do NOT use:

- title
- description
- path
- suggestion
- fix

Use CHANGES_REQUESTED if implementation changes are required.

If any CRITICAL or HIGH finding exists, status MUST NOT be PASS.

If there are no findings, return:

"findings": []
`.trim();
  }

  return `
# Amiral QA Gate

Validate the integrated implementation for workflow:

${workflowId}

You are the QA Agent.

Run the appropriate validation available in the repository:

- build
- type checking
- linting
- unit tests
- integration tests
- end-to-end tests when applicable
- regression checks

Do not implement fixes.

Write the result JSON to exactly:

${resultFile}

The result MUST use exactly this structure:

{
  "workflow_id": "${workflowId}",
  "gate": "qa",
  "status": "PASS",
  "summary": "Short QA summary",
  "findings": [
    {
      "severity": "HIGH",
      "issue": "Description of the validation failure",
      "file": "optional/path/to/file.ts",
      "line": 42,
      "recommendation": "Recommended fix"
    }
  ]
}

Allowed QA statuses:

- PASS
- FAIL
- BLOCKED

Every finding MUST use only these keys:

- severity
- issue
- file
- line
- recommendation

If there are no findings, return:

"findings": []
`.trim();
}

async function writePrompt(
  cwd: string,
  workflowId: string,
  gate: GateType,
): Promise<{
  promptFile: string;
  resultFile: string;
}> {
  const resultFile = resolve(cwd, ".amiral", "gates", `${gate}-result.json`);

  const promptFile = resolve(cwd, ".amiral", "gates", `${gate}-prompt.md`);

  await mkdir(dirname(promptFile), {
    recursive: true,
  });

  await writeFile(
    promptFile,
    buildGatePrompt(workflowId, gate, resultFile),
    "utf8",
  );

  return {
    promptFile,
    resultFile,
  };
}

type GateRunnerOptions = {
  workflowId?: string;
  transport?: PromptTransportProvider;
  onEvent?: (line: string) => void;
};

async function runGate(
  workflowId: string,
  gate: GateType,
  transport?: PromptTransportProvider,
  onEvent?: (line: string) => void,
): Promise<{ result: QualityGateResult; resultFile: string }> {
  const teamConfig: TeamConfig = await loadTeamConfig();

  const providerName = resolveDefaultProviderName(teamConfig);

  const resolvedTransport = transport ?? getPromptTransport(providerName);

  const integration = await createIntegrationWorkspace(workflowId);

  const { promptFile, resultFile } = await writePrompt(
    integration.worktreePath,
    workflowId,
    gate,
  );

  const agent = gate === "review" ? "reviewer" : "qa";

  onEvent?.(
    `Running ${gate} gate via provider "${providerName}" (agent: ${agent})...`,
  );

  const prompt = buildGatePrompt(workflowId, gate, resultFile);

  const transportInput: PromptTransportInput = {
    agent,
    prompt,
    cwd: integration.worktreePath,
    teamConfig,
  };

  const outcome: PromptTransportOutput = await resolvedTransport.runPrompt(
    transportInput,
  );

  if (outcome.exitCode !== 0) {
    const providerError = classifyProviderFailure({
      provider: providerName,
      message: `Provider exited with code ${outcome.exitCode} during ${gate} gate.`,
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      stdout: outcome.stdout,
    });

    throw new Error(
      `${gate} gate failed — ${describeProviderError(providerError)}\n` +
        (outcome.stderr.trim() ||
          outcome.stdout.trim() ||
          "No process output was captured."),
    );
  }

  const rawResult = await loadJson<RawQualityGateResult>(resultFile);

  const result = normalizeQualityGateResult(rawResult);

  await validateContract("quality-gate", result);

  // Canonical formatı dosyaya geri yaz.
  await writeJson(resultFile, result);

  if (result.workflow_id !== workflowId) {
    throw new Error(`${gate} result workflow mismatch.`);
  }

  if (result.gate !== gate) {
    throw new Error(`${gate} result gate mismatch.`);
  }

  return { result, resultFile };
}

export type ReviewGateOutcome = {
  workflowId: string;
  verdict: ReviewVerdict;
  summary: string;
  findings: QualityGateFinding[];
  resultFile: string;
};

/**
 * Run the review gate for a workflow (default: active workflow).
 */
export async function runReviewGate(
  options: GateRunnerOptions = {},
): Promise<ReviewGateOutcome> {
  const state = await loadState(options.workflowId);

  const { result, resultFile } = await runGate(
    state.workflow_id,
    "review",
    options.transport,
    options.onEvent,
  );

  return {
    workflowId: state.workflow_id,
    verdict: result.status as ReviewVerdict,
    summary: result.summary,
    findings: result.findings,
    resultFile,
  };
}

export type QaGateOutcome = {
  workflowId: string;
  verdict: QaVerdict;
  summary: string;
  findings: QualityGateFinding[];
  /** Reserved for structured check results; always undefined today. */
  checks?: Array<Record<string, unknown>>;
  resultFile: string;
  /** True when the QA PASS marked the workflow completed. */
  workflowCompleted: boolean;
};

/**
 * Run the QA gate for a workflow (default: active workflow).
 *
 * Existing side effect preserved: a QA PASS marks the workflow completed.
 */
export async function runQaGate(
  options: GateRunnerOptions = {},
): Promise<QaGateOutcome> {
  const state = await loadState(options.workflowId);

  const { result, resultFile } = await runGate(
    state.workflow_id,
    "qa",
    options.transport,
    options.onEvent,
  );

  let workflowCompleted = false;

  if (result.status === "PASS") {
    state.status = "completed";

    await saveState(state);

    workflowCompleted = true;
  }

  return {
    workflowId: state.workflow_id,
    verdict: result.status as QaVerdict,
    summary: result.summary,
    findings: result.findings,
    checks: undefined,
    resultFile,
    workflowCompleted,
  };
}
