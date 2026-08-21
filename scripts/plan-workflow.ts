#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import spawn from "cross-spawn";

import type { WorkflowType } from "./lib/types.js";
import type { TeamConfig } from "./lib/team-config.js";
import { loadTeamConfig } from "./lib/team-config.js";
import { getKnownCapabilities } from "./lib/capability-scheduler.js";
import {
  buildPlannerPrompt,
  loadTaskGraphFromPlanFile,
  normalizePlannerResult,
  planToTaskGraph,
  validatePlannerPlanWithSchema,
} from "./lib/task-graph-planner.js";
import type { TaskGraphPlan } from "./lib/task-graph-planner.js";
import {
  analyzeTaskGraph,
  formatTaskGraphAnalysis,
} from "./lib/task-graph-analysis.js";
import { extractJsonObject, extractTextEvents } from "./lib/opencode-adapter.js";
import { sanitizeSegment } from "./lib/git-worktree.js";
import { writeJson } from "./lib/workflow-store.js";

type CliOptions = {
  command?: string;
  workflowType?: WorkflowType;
  goal?: string;
  name?: string;
  planFile?: string;
};

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function usage(): never {
  console.error(
    `
Usage:
  npx tsx scripts/plan-workflow.ts <feature|bugfix|refactor> "<goal>" [options]
  npx tsx scripts/plan-workflow.ts analyze <plan-or-graph-file>

Options:
  --name <name>        Plan name prefix (default: workflow type)
  --plan-file <file>   Use an existing planner JSON result instead of running the planner agent

Examples:
  npx tsx scripts/plan-workflow.ts feature "Add JWT authentication with PostgreSQL and a Next.js login page"
  npx tsx scripts/plan-workflow.ts feature "Add JWT auth" --plan-file raw-planner-output.json
  npx tsx scripts/plan-workflow.ts analyze plans/jwt-auth-1a2b3c4d/planner-result.json
`.trim(),
  );

  process.exit(2);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--name": {
        const value = args[index + 1];
        if (!value) fail(`${arg} requires a value.`);
        options.name = value;
        index += 1;
        break;
      }

      case "--plan-file": {
        const value = args[index + 1];
        if (!value) fail(`${arg} requires a file path.`);
        options.planFile = value;
        index += 1;
        break;
      }

      default:
        positional.push(arg);
    }
  }

  if (positional[0] === "analyze") {
    options.command = "analyze";
    options.goal = positional[1];
    return options;
  }

  const [type, goal] = positional;

  if (!type || !["feature", "bugfix", "refactor"].includes(type)) {
    usage();
  }

  if (!goal?.trim()) {
    fail("A non-empty goal is required.");
  }

  options.workflowType = type as WorkflowType;
  options.goal = goal.trim();

  return options;
}

function resolveOpenCodeOptions(config: TeamConfig): {
  binary: string;
  autoApprove: boolean;
  model?: string;
} {
  const root = config as TeamConfig & {
    opencode?: {
      binary?: string;
      auto_approve?: boolean;
    };
  };

  const model = config.agents?.planner?.model;

  return {
    binary:
      typeof root.opencode?.binary === "string" && root.opencode.binary.trim()
        ? root.opencode.binary.trim()
        : "opencode",
    autoApprove: root.opencode?.auto_approve === true,
    model:
      typeof model === "string" && model.trim() ? model.trim() : undefined,
  };
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);

    child.on("close", (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Run the Planner agent through OpenCode and return its raw text output.
 */
async function runPlannerAgent(
  teamConfig: TeamConfig,
  prompt: string,
): Promise<string> {
  const options = resolveOpenCodeOptions(teamConfig);

  const args = [
    "run",
    prompt,
    "--agent",
    "planner",
    "--dir",
    process.cwd(),
    "--format",
    "json",
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.autoApprove) {
    args.push("--auto");
  }

  console.log(`🧠 Running planner agent (${options.binary})...`);

  const result = await runProcess(options.binary, args, process.cwd());

  if (result.exitCode !== 0) {
    throw new Error(
      `OpenCode exited with code ${result.exitCode} while planning.\n` +
        (result.stderr.trim() ||
          result.stdout.trim() ||
          "No process output was captured."),
    );
  }

  const text = extractTextEvents(result.stdout) || result.stdout;

  if (!text.trim()) {
    throw new Error(
      "The planner agent produced no usable output to extract a plan from.",
    );
  }

  return text;
}

function printPlanSummary(plan: TaskGraphPlan): void {
  console.log("");
  console.log(`Goal: ${plan.goal}`);
  console.log(`Summary: ${plan.summary}`);
  if (plan.workflow_type) {
    console.log(`Workflow type: ${plan.workflow_type}`);
  }
  console.log(`Tasks: ${plan.tasks.length}`);
  console.log("");

  for (const task of plan.tasks) {
    const capabilities = task.routing?.required_capabilities ?? [];
    const planningBits = [
      task.planning?.priority,
      task.planning?.estimated_complexity,
      task.planning?.risk,
    ]
      .filter(Boolean)
      .join("/");

    console.log(
      `  - ${task.id.padEnd(12)} [${task.agent}]${planningBits ? ` (${planningBits})` : ""} ${task.title}`,
    );
    console.log(
      `    deps: ${task.dependencies.length ? task.dependencies.join(", ") : "none"}` +
        `${capabilities.length ? ` | capabilities: ${capabilities.join(", ")}` : ""}`,
    );
  }
}

async function analyzeCommand(file: string): Promise<void> {
  const teamConfig = await loadTeamConfig();

  const { graph, plan } = await loadTaskGraphFromPlanFile(file, {
    teamConfig,
  });

  if (plan) {
    console.log(`Goal: ${plan.goal}`);
    console.log(`Summary: ${plan.summary}`);
    console.log("");
  }

  console.log(formatTaskGraphAnalysis(analyzeTaskGraph(graph.tasks)));
}

async function planCommand(options: CliOptions): Promise<void> {
  const workflowType = options.workflowType!;
  const goal = options.goal!;

  const teamConfig = await loadTeamConfig();
  const knownCapabilities = getKnownCapabilities(teamConfig);

  let rawText: string;

  if (options.planFile) {
    rawText = await readFile(resolve(process.cwd(), options.planFile), "utf8");
  } else {
    const prompt = buildPlannerPrompt(goal, teamConfig, workflowType);
    rawText = await runPlannerAgent(teamConfig, prompt);
  }

  const planId = `${sanitizeSegment(options.name || workflowType)}-${randomUUID().slice(0, 8)}`;
  const planDir = resolve(process.cwd(), "plans", planId);

  await mkdir(planDir, { recursive: true });
  await writeFile(
    resolve(planDir, "planner-result.raw.txt"),
    rawText,
    "utf8",
  );

  // Recover the JSON object from provider text output.
  const rawPlan = extractJsonObject(rawText);

  if (!rawPlan) {
    throw new Error(
      "Could not extract a JSON object from the planner output. " +
        `Raw output saved to: plans/${planId}/planner-result.raw.txt`,
    );
  }

  await writeJson(resolve(planDir, "planner-result.raw.json"), rawPlan);

  // Normalize small safe schema differences before validation.
  const plan = normalizePlannerResult(rawPlan);

  await validatePlannerPlanWithSchema(plan, { knownCapabilities });

  const graph = planToTaskGraph(plan);

  await writeJson(resolve(planDir, "planner-result.json"), plan);
  await writeJson(resolve(planDir, "task-graph.json"), graph);

  console.log(`✅ Plan validated and saved under: plans/${planId}/`);
  console.log("   - planner-result.raw.txt  (raw provider output)");
  console.log("   - planner-result.raw.json (extracted JSON)");
  console.log("   - planner-result.json     (normalized Task Graph Plan)");
  console.log("   - task-graph.json         (canonical task graph)");

  printPlanSummary(plan);

  console.log("");
  console.log(formatTaskGraphAnalysis(analyzeTaskGraph(graph.tasks)));

  console.log("");
  console.log(
    "Next step (workflow creation is intentionally separate):",
  );
  console.log(
    `  npx tsx scripts/workflow-state.ts create-from-plan plans/${planId}/planner-result.json`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  try {
    if (options.command === "analyze") {
      if (!options.goal) usage();
      await analyzeCommand(options.goal);
      return;
    }

    await planCommand(options);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
