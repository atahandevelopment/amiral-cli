#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import spawn from "cross-spawn";

import type { TeamConfig } from "./lib/team-config.js";
import { loadTeamConfig } from "./lib/team-config.js";
import { validateContract } from "./lib/contract-validator.js";
import { loadJson, loadState, saveState } from "./lib/workflow-store.js";
import { createIntegrationWorkspace } from "./lib/integration.js";

type GateType = "review" | "qa";

type QualityGateResult = {
  workflow_id: string;
  gate: GateType;
  status: "PASS" | "CHANGES_REQUESTED" | "FAIL" | "BLOCKED";
  summary: string;
  findings?: Array<{
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "SUGGESTION";
    file?: string;
    line?: number;
    issue: string;
    recommendation?: string;
  }>;
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

function buildGatePrompt(
  workflowId: string,
  gate: GateType,
  resultPath: string,
): string {
  if (gate === "review") {
    return `
# Amiral Code Review Gate

Review the integrated implementation for workflow:

${workflowId}

You are the Reviewer.

Inspect the entire current worktree diff and relevant repository context.

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

Do not implement fixes.

Write the result JSON to exactly:

${resultPath}

Schema:

{
  "workflow_id": "${workflowId}",
  "gate": "review",
  "status": "PASS",
  "summary": "Short review summary",
  "findings": []
}

Allowed review statuses:
- PASS
- CHANGES_REQUESTED
- BLOCKED

Use CHANGES_REQUESTED if implementation changes are required.

CRITICAL or HIGH findings must never result in PASS.
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

${resultPath}

Schema:

{
  "workflow_id": "${workflowId}",
  "gate": "qa",
  "status": "PASS",
  "summary": "Short QA summary",
  "findings": []
}

Allowed QA statuses:
- PASS
- FAIL
- BLOCKED
`.trim();
}

async function writePrompt(
  cwd: string,
  workflowId: string,
  gate: GateType,
): Promise<{ promptFile: string; resultFile: string }> {
  const resultFile = resolve(
    cwd,
    ".amiral",
    "gates",
    `${gate}-result.json`,
  );

  const promptFile = resolve(
    cwd,
    ".amiral",
    "gates",
    `${gate}-prompt.md`,
  );

  await mkdir(dirname(promptFile), {
    recursive: true,
  });

  await writeFile(
    promptFile,
    buildGatePrompt(
      workflowId,
      gate,
      resultFile,
    ),
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
  const integration = await createIntegrationWorkspace(
    workflowId,
  );

  const { promptFile, resultFile } = await writePrompt(
    integration.worktreePath,
    workflowId,
    gate,
  );

  const agent =
    gate === "review"
      ? "reviewer"
      : "qa";

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

  const result =
    await loadJson<QualityGateResult>(
      resultFile,
    );

  await validateContract(
    "quality-gate",
    result,
  );

  if (result.workflow_id !== workflowId) {
    throw new Error(
      `${gate} result workflow mismatch.`,
    );
  }

  if (result.gate !== gate) {
    throw new Error(
      `${gate} result gate mismatch.`,
    );
  }

  return result;
}

async function main(): Promise<void> {
  const [gate, workflowIdArg] = process.argv.slice(2);

  if (!["review", "qa"].includes(gate)) {
    fail(
      "Usage: npx tsx scripts/run-quality-gate.ts <review|qa> [workflow-id]",
    );
  }

  try {
    const state = await loadState(workflowIdArg);
    const result = await runGate(
      state.workflow_id,
      gate as GateType,
    );

    console.log("");
    console.log(
      `✅ ${gate.toUpperCase()} gate: ${result.status}`,
    );
    console.log(result.summary);

    if (
      gate === "qa" &&
      result.status === "PASS"
    ) {
      state.status = "completed";
      await saveState(state);

      console.log("");
      console.log(
        `✅ Workflow ${state.workflow_id} completed.`,
      );
    }
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : String(error),
    );
  }
}

void main();
