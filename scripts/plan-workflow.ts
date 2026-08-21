#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { WorkflowType } from "./lib/types.js";
import {
  loadTeamConfig,
  resolveDefaultProviderName,
} from "./lib/team-config.js";
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
import { extractJsonObject, extractTextEvents } from "./lib/providers/output-extraction.js";
import { getPromptTransport } from "./lib/providers/provider-registry.js";
import {
  classifyProviderFailure,
  describeProviderError,
} from "./lib/providers/provider-error.js";
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

/**
 * Run the Planner agent through the configured execution provider and
 * return its raw text output.
 */
async function runPlannerAgent(
  teamConfig: Awaited<ReturnType<typeof loadTeamConfig>>,
  prompt: string,
): Promise<string> {
  const providerName = resolveDefaultProviderName(teamConfig);

  const transport = getPromptTransport(providerName);

  console.log(`🧠 Running planner agent (provider: ${providerName})...`);

  const outcome = await transport.runPrompt({
    agent: "planner",
    prompt,
    cwd: process.cwd(),
    teamConfig,
  });

  if (outcome.exitCode !== 0) {
    const providerError = classifyProviderFailure({
      provider: providerName,
      message: `Provider exited with code ${outcome.exitCode} while planning.`,
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      stdout: outcome.stdout,
    });

    throw new Error(
      `Planner failed — ${describeProviderError(providerError)}\n` +
        (outcome.stderr.trim() ||
          outcome.stdout.trim() ||
          "No process output was captured."),
    );
  }

  const text = extractTextEvents(outcome.stdout) || outcome.stdout;

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
