import spawn from "cross-spawn";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ExecutionRequest } from "./execution-request.js";
import type { TeamConfig } from "./team-config.js";
import { loadJson, writeJson } from "./workflow-store.js";
import { validateContract } from "./contract-validator.js";

export type AgentResult = {
  workflow_id: string;
  task_id: string;
  lease_id: string;
  agent: ExecutionRequest["agent"];
  status: "completed" | "failed" | "blocked";
  summary: string;
  files_changed?: string[];
  commands_executed?: string[];
  tests?: Array<
    | string
    | {
        name: string;
        result: "pass" | "fail" | "skipped";
        details?: string;
      }
  >;
  risks?: string[];
  additional_tasks_required?: string[];
  blocked_reason?: string;
  failure_reason?: string;
};

type OpenCodeOptions = {
  binary: string;
  autoApprove: boolean;
  model?: string;
};

export type OpenCodeExecutionContext = {
  cwd?: string;
};

function resolveOpenCodeOptions(
  config: TeamConfig,
  agent: ExecutionRequest["agent"],
): OpenCodeOptions {
  const rootConfig = config as TeamConfig & {
    opencode?: {
      binary?: string;
      auto_approve?: boolean;
    };
  };

  const binary =
    typeof rootConfig.opencode?.binary === "string" &&
    rootConfig.opencode.binary.trim()
      ? rootConfig.opencode.binary.trim()
      : "opencode";

  const autoApprove = rootConfig.opencode?.auto_approve === true;

  const model = config.agents?.[agent]?.model;

  return {
    binary,
    autoApprove,
    model: typeof model === "string" && model.trim() ? model.trim() : undefined,
  };
}

function buildPrompt(
  request: ExecutionRequest,
  localResultPath: string,
): string {
  return `
# OpenCode AI Team Execution Task

You are the assigned "${request.agent}" specialist.

## Workflow

Workflow ID: ${request.workflow_id}
Task ID: ${request.task_id}
Lease ID: ${request.lease_id}
Attempt: ${request.attempt}/${request.max_attempts}

## Task

### Title

${request.title}

### Description

${request.description}

### Acceptance Criteria

${request.acceptance_criteria.map((item) => `- ${item}`).join("\n")}

### Completed Dependencies

${
  request.context.dependencies.length
    ? request.context.dependencies.map((item) => `- ${item}`).join("\n")
    : "- none"
}

### Relevant Skills

${
  request.context.skills.length
    ? request.context.skills.map((item) => `- ${item}`).join("\n")
    : "- none"
}

## Execution Rules

1. Inspect the existing repository before making changes.
2. Follow your configured ${request.agent} agent instructions.
3. Follow existing project architecture and conventions.
4. Work only on this assigned task.
5. Do not orchestrate or delegate to other agents.
6. Load only relevant skills.
7. Run appropriate tests, build, lint, or type checking.
8. Do not modify workflow state files.
9. Do not silently expand the task scope.

## Mandatory Result

Before finishing, write a JSON Agent Result to exactly:

${localResultPath}

The result must use this exact structure:

\`\`\`json
{
  "workflow_id": "${request.workflow_id}",
  "task_id": "${request.task_id}",
  "lease_id": "${request.lease_id}",
  "agent": "${request.agent}",
  "status": "completed",
  "summary": "Short summary of the work",
  "files_changed": [],
  "commands_executed": [],
 "tests": [
  {
    "name": "dotnet test",
    "result": "pass",
    "details": "17 tests passed"
  }
  ],
  "risks": [],
  "additional_tasks_required": []
}
\`\`\`

IMPORTANT:
- Every item in "tests" MUST be an object.
- "result" MUST be one of: "pass", "fail", "skipped".
- Do not put plain strings inside the "tests" array.

Allowed status values:

- completed
- failed
- blocked

For failed status include:

\`\`\`json
"failure_reason": "..."
\`\`\`

For blocked status include:

\`\`\`json
"blocked_reason": "..."
\`\`\`

Writing the result file is mandatory.

Do not finish with only a conversational response.
`.trim();
}

async function writeTaskPromptFile(
  request: ExecutionRequest,
  cwd: string,
  localResultPath: string,
): Promise<string> {
  const promptPath = resolve(
    cwd,
    ".amiral",
    "requests",
    `${request.task_id}.prompt.md`,
  );

  await mkdir(dirname(promptPath), {
    recursive: true,
  });

  await writeFile(promptPath, buildPrompt(request, localResultPath), "utf8");

  return promptPath;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: cwd,
      stdio: "inherit",
    });

    child.on("error", reject);

    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
  });
}

export async function executeWithOpenCode(
  request: ExecutionRequest,
  teamConfig: TeamConfig,
  context: OpenCodeExecutionContext = {},
): Promise<AgentResult> {
  await validateContract("execution-request", request);

  const cwd = context.cwd ?? process.cwd();

  const localResultPath = resolve(
    cwd,
    ".amiral",
    "results",
    `${request.task_id}.json`,
  );

  await mkdir(dirname(localResultPath), {
    recursive: true,
  });

  const options = resolveOpenCodeOptions(teamConfig, request.agent);

  const promptFile = await writeTaskPromptFile(request, cwd, localResultPath);

  const args = [
    "run",
    "Execute the attached task specification completely. " +
      "Follow all instructions in the attached file. " +
      "Do not finish until the mandatory Agent Result JSON has been written.",
    "--agent",
    request.agent,
    "--dir",
    cwd,
    "--format",
    "json",
    "--file",
    promptFile,
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.autoApprove) {
    args.push("--auto");
  }

  const exitCode = await runProcess(options.binary, args, cwd);

  if (exitCode !== 0) {
    throw new Error(
      `OpenCode exited with code ${exitCode} for task "${request.task_id}".`,
    );
  }

  let result: AgentResult;

  try {
    result = await loadJson<AgentResult>(localResultPath);
  } catch {
    throw new Error(
      `Agent finished but did not produce a readable result file at "${localResultPath}".`,
    );
  }

  function normalizeAgentResult(result: AgentResult): AgentResult {
    if (!Array.isArray(result.tests)) {
      return result;
    }

    result.tests = result.tests.map((test) => {
      if (typeof test === "string") {
        return {
          name: test,
          result: "pass",
        };
      }

      return test;
    });

    return result;
  }

  result = await loadJson<AgentResult>(localResultPath);
  result = normalizeAgentResult(result);

  await validateContract("agent-result", result);

  if (result.workflow_id !== request.workflow_id) {
    throw new Error(
      `Result workflow_id mismatch: expected "${request.workflow_id}", got "${result.workflow_id}".`,
    );
  }

  if (result.task_id !== request.task_id) {
    throw new Error(
      `Result task_id mismatch: expected "${request.task_id}", got "${result.task_id}".`,
    );
  }

  if (result.lease_id !== request.lease_id) {
    throw new Error(
      `Stale result rejected for "${request.task_id}": lease mismatch.`,
    );
  }

  if (result.agent !== request.agent) {
    throw new Error(
      `Result agent mismatch: expected "${request.agent}", got "${result.agent}".`,
    );
  }

  const canonicalResultPath = resolve(
    process.cwd(),
    request.context.result_path,
  );

  await writeJson(canonicalResultPath, result);

  return result;
}
