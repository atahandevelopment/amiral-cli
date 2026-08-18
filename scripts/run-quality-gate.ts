#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import spawn from "cross-spawn";

import type { TeamConfig } from "./lib/team-config.js";
import { loadTeamConfig } from "./lib/team-config.js";
import { validateContract } from "./lib/contract-validator.js";
import {
  loadJson,
  loadState,
  saveState,
  writeJson,
} from "./lib/workflow-store.js";
import { createIntegrationWorkspace } from "./lib/integration.js";

type GateType = "review" | "qa";

type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "SUGGESTION";

type QualityGateFinding = {
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

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    child.on("error", reject);

    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
  });
}

function resolveBinary(config: TeamConfig): string {
  const root = config as TeamConfig & {
    opencode?: {
      binary?: string;
      auto_approve?: boolean;
    };
  };

  return root.opencode?.binary?.trim() || "opencode";
}

function resolveAutoApprove(config: TeamConfig): boolean {
  const root = config as TeamConfig & {
    opencode?: {
      auto_approve?: boolean;
    };
  };

  return root.opencode?.auto_approve === true;
}

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

function buildGatePrompt(
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

async function runGate(
  workflowId: string,
  gate: GateType,
): Promise<QualityGateResult> {
  const teamConfig = await loadTeamConfig();

  const integration = await createIntegrationWorkspace(workflowId);

  const { promptFile, resultFile } = await writePrompt(
    integration.worktreePath,
    workflowId,
    gate,
  );

  const agent = gate === "review" ? "reviewer" : "qa";

  const args = [
    "run",
    `Execute the attached ${gate} gate completely and write the required JSON result.`,
    "--agent",
    agent,
    "--dir",
    integration.worktreePath,
    "--format",
    "json",
    "--file",
    promptFile,
  ];

  if (resolveAutoApprove(teamConfig)) {
    args.push("--auto");
  }

  const exitCode = await runProcess(
    resolveBinary(teamConfig),
    args,
    integration.worktreePath,
  );

  if (exitCode !== 0) {
    throw new Error(
      `OpenCode exited with code ${exitCode} during ${gate} gate.`,
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

  return result;
}

async function main(): Promise<void> {
  const [gateArg, workflowIdArg] = process.argv.slice(2);

  if (gateArg !== "review" && gateArg !== "qa") {
    fail(
      "Usage: npx tsx scripts/run-quality-gate.ts <review|qa> [workflow-id]",
    );
  }

  try {
    const state = await loadState(workflowIdArg);

    const gate = gateArg as GateType;

    const result = await runGate(state.workflow_id, gate);

    console.log("");
    console.log(`✅ ${gate.toUpperCase()} gate: ${result.status}`);
    console.log(result.summary);

    if (result.findings.length) {
      console.log("");
      console.log("Findings:");

      for (const finding of result.findings) {
        const location = finding.file
          ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})`
          : "";

        console.log(`- [${finding.severity}] ${finding.issue}${location}`);

        if (finding.recommendation) {
          console.log(`  Recommendation: ${finding.recommendation}`);
        }
      }
    }

    if (gate === "review" && result.status !== "PASS") {
      console.log("");
      console.log("⛔ QA must not run until Review returns PASS.");

      return;
    }

    if (gate === "qa" && result.status === "PASS") {
      state.status = "completed";

      await saveState(state);

      console.log("");
      console.log(`✅ Workflow ${state.workflow_id} completed.`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
