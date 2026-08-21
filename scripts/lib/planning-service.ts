import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { TaskGraph, WorkflowType } from "./types.js";
import type { TaskGraphPlan } from "./task-graph-planner.js";
import { buildPlannerPrompt, loadTaskGraphFromPlanFile, normalizePlannerResult, planToTaskGraph, validatePlannerPlanWithSchema } from "./task-graph-planner.js";
import { analyzeTaskGraph, type TaskGraphAnalysis } from "./task-graph-analysis.js";
import { getKnownCapabilities } from "./capability-scheduler.js";
import { sanitizeSegment } from "./git-worktree.js";
import { extractJsonObject, extractTextEvents } from "./providers/output-extraction.js";
import { getPromptTransport } from "./providers/provider-registry.js";
import { classifyProviderFailure, describeProviderError } from "./providers/provider-error.js";
import { loadTeamConfig, resolveDefaultProviderName } from "./team-config.js";
import { writeJson } from "./workflow-store.js";

export type { WorkflowType };
export type PlanWorkflowOptions = { type: WorkflowType; goal: string; name?: string; planFile?: string; onEvent?: (eventOrLine: string) => void };
export type PlanWorkflowResult = { planId: string; planDir: string; plannerResult: TaskGraphPlan; taskGraph: TaskGraph; analysis: TaskGraphAnalysis; artifactFiles: { plannerResult: string; taskGraph: string; rawText?: string; rawJson?: string } };

async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }

export async function resolvePlanReference(reference: string): Promise<string> {
  const explicit = isAbsolute(reference) ? reference : resolve(process.cwd(), reference);
  if (await exists(explicit)) return explicit;
  for (const name of ["planner-result.json", "task-graph.json"]) {
    const candidate = resolve(process.cwd(), "plans", reference, name);
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`Plan not found: ${reference}. Pass an existing file or a plan id under plans/.`);
}

export async function analyzePlanFile(file: string): Promise<{ plannerResult?: TaskGraphPlan; taskGraph: TaskGraph; analysis: TaskGraphAnalysis }> {
  const teamConfig = await loadTeamConfig();
  const { graph, plan } = await loadTaskGraphFromPlanFile(await resolvePlanReference(file), { teamConfig });
  return { ...(plan ? { plannerResult: plan } : {}), taskGraph: graph, analysis: analyzeTaskGraph(graph.tasks) };
}

export async function planWorkflow(options: PlanWorkflowOptions): Promise<PlanWorkflowResult> {
  const teamConfig = await loadTeamConfig();
  const knownCapabilities = getKnownCapabilities(teamConfig);
  let rawText: string;
  if (options.planFile) {
    rawText = await readFile(await resolvePlanReference(options.planFile), "utf8");
  } else {
    if (!options.goal.trim()) throw new Error("A non-empty goal is required when --plan-file is not supplied.");
    const provider = resolveDefaultProviderName(teamConfig);
    options.onEvent?.(`Running planner agent (provider: ${provider})...`);
    const outcome = await getPromptTransport(provider).runPrompt({ agent: "planner", prompt: buildPlannerPrompt(options.goal.trim(), teamConfig, options.type), cwd: process.cwd(), teamConfig });
    if (outcome.exitCode !== 0) {
      const failure = classifyProviderFailure({ provider, message: `Provider exited with code ${outcome.exitCode} while planning.`, exitCode: outcome.exitCode, stderr: outcome.stderr, stdout: outcome.stdout });
      throw new Error(`Planner failed — ${describeProviderError(failure)}\n${outcome.stderr.trim() || outcome.stdout.trim() || "No process output was captured."}`);
    }
    rawText = extractTextEvents(outcome.stdout) || outcome.stdout;
    if (!rawText.trim()) throw new Error("The planner agent produced no usable output to extract a plan from.");
  }
  const planId = `${sanitizeSegment(options.name || options.type)}-${randomUUID().slice(0, 8)}`;
  const planDir = resolve(process.cwd(), "plans", planId);
  await mkdir(planDir, { recursive: true });
  const rawTextFile = resolve(planDir, "planner-result.raw.txt");
  const rawJsonFile = resolve(planDir, "planner-result.raw.json");
  await writeFile(rawTextFile, rawText, "utf8");
  const rawPlan = extractJsonObject(rawText);
  if (!rawPlan) throw new Error(`Could not extract a JSON object from planner output. Raw output saved to: plans/${planId}/planner-result.raw.txt`);
  await writeJson(rawJsonFile, rawPlan);
  const plannerResult = normalizePlannerResult(rawPlan);
  await validatePlannerPlanWithSchema(plannerResult, { knownCapabilities });
  const taskGraph = planToTaskGraph(plannerResult);
  const plannerFile = resolve(planDir, "planner-result.json");
  const graphFile = resolve(planDir, "task-graph.json");
  await writeJson(plannerFile, plannerResult); await writeJson(graphFile, taskGraph);
  return { planId, planDir, plannerResult, taskGraph, analysis: analyzeTaskGraph(taskGraph.tasks), artifactFiles: { plannerResult: plannerFile, taskGraph: graphFile, rawText: rawTextFile, rawJson: rawJsonFile } };
}
