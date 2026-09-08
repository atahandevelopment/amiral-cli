import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { TaskGraph, WorkflowType } from "./types.js";
import type { TaskGraphPlan } from "./task-graph-planner.js";
import { buildPlannerPrompt, loadTaskGraphFromPlanFile, normalizePlannerResult, planToTaskGraph, validatePlannerPlanWithSchema } from "./task-graph-planner.js";
import { analyzeTaskGraph, type TaskGraphAnalysis } from "./task-graph-analysis.js";
import { getKnownCapabilities } from "./capability-scheduler.js";
import { sanitizeSegment } from "./git-worktree.js";
import { extractJsonObjects, extractTextEvents } from "./providers/output-extraction.js";
import { getPromptTransport } from "./providers/provider-registry.js";
import { classifyProviderFailure, describeProviderError } from "./providers/provider-error.js";
import type { PromptTransportProvider } from "./providers/provider.js";
import { loadTeamConfig, resolveDefaultProviderName } from "./team-config.js";
import { resolveProviderConfig } from "./team-config.js";
import { calculateRetryDelay } from "./providers/retry-policy.js";
import { writeJson } from "./workflow-store.js";
import { validateContract } from "./contract-validator.js";
import { resolveProjectUiConfig, type ProjectUiConfig, type TeamConfig } from "./team-config.js";

export type { WorkflowType };
export const PLANNING_PROTOCOL_AGENT = "planning-protocol";
export type DesignSpec = { version: 1; name: string; summary: string; routes: Array<{ path: string; description: string; acceptance_criteria: string[] }> };
export type PlanWorkflowOptions = { type: WorkflowType; goal: string; /** Complete, authoritative user request. Falls back to goal for existing callers. */ originalRequest?: string; name?: string; planFile?: string; onEvent?: (eventOrLine: string) => void; transport?: PromptTransportProvider; delay?: (milliseconds: number) => Promise<void>; random?: () => number };
export type PlanWorkflowResult = { planId: string; planDir: string; plannerResult: TaskGraphPlan; taskGraph: TaskGraph; analysis: TaskGraphAnalysis; artifactFiles: { plannerResult: string; taskGraph: string; rawText?: string; rawJson?: string; diagnostics?: string; designSpec?: string; designDiagnostics?: string } };

const DIAGNOSTIC_LIMIT = 4_000;
const FEEDBACK_LIMIT = 1_000;

function safeDiagnostic(value: string, limit = DIAGNOSTIC_LIMIT): string {
  const redacted = value
    .replace(/(authorization\s*[:=]\s*["']?bearer\s+)[^\s,"']+/gi, "$1[REDACTED]")
    .replace(/\bbearer\s+[^\s,"']+/gi, "Bearer [REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd|client[_-]?secret|secret)["']?\s*[:=]\s*)(["'])([\s\S]*?)\2/gi, "$1$2[REDACTED]$2")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd|client[_-]?secret|secret)["']?\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]");
  return redacted.length > limit ? `${redacted.slice(0, limit)}…[truncated]` : redacted;
}

async function parsePlannerOutput(text: string, knownCapabilities: string[]): Promise<{ raw: unknown; plan: TaskGraphPlan }> {
  const candidates = extractJsonObjects(text);
  if (!candidates.length) throw new Error("Could not extract a complete JSON object from planner output.");
  let lastIssue = "";
  for (const raw of candidates) {
    try {
      const plan = normalizePlannerResult(raw);
      await validatePlannerPlanWithSchema(plan, { knownCapabilities });
      return { raw, plan };
    } catch (error) { lastIssue = error instanceof Error ? error.message : String(error); }
  }
  throw new Error(`No extracted JSON object matched the planner contract (${candidates.length} candidate${candidates.length === 1 ? "" : "s"}). Last validation error: ${lastIssue}`);
}

/** Conservative intake check: only material user-facing work earns a design pass. */
export function isMeaningfulUiRequest(request: string): boolean {
  const text = request.toLowerCase();
  const trivial = /\b(typo|copy[- ]only|text[- ]only|rename|wording|spelling)\b/.test(text) &&
    !/\b(layout|responsive|interaction|accessibility|animation|redesign|new (?:page|screen|form|modal))\b/.test(text);
  if (trivial) return false;
  const ui = /\b(ui|ux|user interface|frontend|page|screen|dashboard|layout|responsive|navigation|navbar|sidebar|modal|dialog|form|component|design system|accessibility|animation|visual)\b/.test(text);
  const backendOnly = /\b(api|endpoint|database|migration|schema|queue|worker|service|repository|controller|authentication token|logging)\b/.test(text) &&
    !/\b(page|screen|frontend|ui|ux|form|dashboard|layout|responsive|visual)\b/.test(text);
  return ui && !backendOnly;
}

async function parseDesignOutput(text: string): Promise<DesignSpec> {
  const candidates = extractJsonObjects(text);
  if (!candidates.length) throw new Error("Could not extract a complete JSON object from designer output.");
  let issue = "";
  for (const candidate of candidates) {
    try { await validateContract("design-spec", candidate); return candidate as DesignSpec; }
    catch (error) { issue = error instanceof Error ? error.message : String(error); }
  }
  throw new Error(`No extracted JSON object matched the design-spec contract. Last validation error: ${issue}`);
}

function buildDesignerPrompt(request: string, ui: ProjectUiConfig): string {
  return `# UI/UX Design Specification\n\nInspect the repository and produce an implementation-ready design specification for this request:\n\n${request}\n\nConfigured designer: ${ui.designer}\nConfigured skill: ${ui.skill ?? "none"}\nStyle preset: ${ui.style_preset ?? "preserve the existing design system"}\nAnimation: ${ui.animation.enabled ? ui.animation.intensity : "disabled"}\n\n${ui.skill ? `Load and use the configured skill \"${ui.skill}\" only where relevant.` : "Do not load an optional design skill."}\nReturn one JSON object only, exactly matching .opencode/schemas/design-spec.schema.json. Do not implement files.`;
}

async function createDesignSpec(input: { request: string; ui: ProjectUiConfig; teamConfig: TeamConfig; transport: PromptTransportProvider; planDir: string; planId: string; onEvent?: (line: string) => void }): Promise<{ file: string; diagnosticsFile: string }> {
  const diagnosticsFile = resolve(input.planDir, "uiux-design-diagnostics.json");
  const diagnostics: Array<{ attempt: number; issue?: string; stdoutPreview: string; stderrPreview: string }> = [];
  const base = buildDesignerPrompt(input.request, input.ui);
  let issue = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    input.onEvent?.(`Running UI/UX designer (${input.ui.designer}), attempt ${attempt}/3...`);
    const prompt = attempt === 1 ? base : `${base}\n\nPrevious output was rejected: ${safeDiagnostic(issue, FEEDBACK_LIMIT)}\nReturn corrected JSON only.`;
    const outcome = await input.transport.runPrompt({ agent: input.ui.designer, prompt, cwd: process.cwd(), teamConfig: input.teamConfig, model: input.teamConfig.agents?.[input.ui.designer]?.model });
    if (outcome.exitCode !== 0) {
      issue = `designer exited with code ${outcome.exitCode}`;
      diagnostics.push({ attempt, issue, stdoutPreview: safeDiagnostic(outcome.stdout), stderrPreview: safeDiagnostic(outcome.stderr) });
      await writeJson(diagnosticsFile, diagnostics);
      throw new Error(`UI/UX designer failed. Diagnostics saved to: plans/${input.planId}/uiux-design-diagnostics.json`);
    }
    const text = extractTextEvents(outcome.stdout) || outcome.stdout;
    try {
      const spec = await parseDesignOutput(text);
      diagnostics.push({ attempt, stdoutPreview: safeDiagnostic(outcome.stdout), stderrPreview: safeDiagnostic(outcome.stderr) });
      const file = resolve(input.planDir, "uiux-design-spec.json");
      await writeJson(file, spec); await writeJson(diagnosticsFile, diagnostics);
      return { file, diagnosticsFile };
    } catch (error) {
      issue = error instanceof Error ? error.message : String(error);
      diagnostics.push({ attempt, issue: safeDiagnostic(issue, FEEDBACK_LIMIT), stdoutPreview: safeDiagnostic(outcome.stdout), stderrPreview: safeDiagnostic(outcome.stderr) });
      await writeJson(diagnosticsFile, diagnostics);
    }
  }
  throw new Error(`UI/UX designer recovery exhausted after 3 attempts: ${safeDiagnostic(issue, FEEDBACK_LIMIT)}. Diagnostics saved to: plans/${input.planId}/uiux-design-diagnostics.json`);
}

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
  const originalRequest = options.originalRequest?.trim() || options.goal.trim();
  if (!options.planFile && !originalRequest) throw new Error("A non-empty goal or original request is required when --plan-file is not supplied.");
  let rawText: string;
  let rawPlan: unknown;
  let plannerResult: TaskGraphPlan | undefined;
  if (options.planFile) {
    rawText = await readFile(await resolvePlanReference(options.planFile), "utf8");
    ({ raw: rawPlan, plan: plannerResult } = await parsePlannerOutput(rawText, knownCapabilities));
  } else {
    rawText = "";
  }
  const planId = `${sanitizeSegment(options.name || options.type)}-${randomUUID().slice(0, 8)}`;
  const planDir = resolve(process.cwd(), "plans", planId);
  await mkdir(planDir, { recursive: true });
  let designArtifacts: { file: string; diagnosticsFile: string } | undefined;
  const diagnosticsFile = resolve(planDir, "planner-diagnostics.json");
  const diagnostics: Array<{ attempt: number; issue?: string; stdoutPreview: string; stderrPreview: string }> = [];
  if (!options.planFile) {
    const provider = resolveDefaultProviderName(teamConfig);
    options.onEvent?.(`Running planner agent (provider: ${provider})...`);
    const transport = options.transport ?? getPromptTransport(provider);
    const retry = resolveProviderConfig(teamConfig, provider).retry;
    const delay = options.delay ?? ((milliseconds: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
    const ui = resolveProjectUiConfig(teamConfig);
    if (ui.enabled && isMeaningfulUiRequest(originalRequest)) {
      designArtifacts = await createDesignSpec({ request: originalRequest, ui, teamConfig, transport, planDir, planId, onEvent: options.onEvent });
    }
    const designRef = designArtifacts ? [`plans/${planId}/uiux-design-spec.json`] : [];
    const basePrompt = buildPlannerPrompt(originalRequest, teamConfig, options.type, designRef);
    let issue = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const prompt = attempt === 1 ? basePrompt : `${basePrompt}\n\nYour previous response was rejected: ${safeDiagnostic(issue, FEEDBACK_LIMIT)}\nReturn a corrected, complete JSON object only. Do not ask questions; make reasonable engineering assumptions consistent with the ${options.type} workflow.`;
      let outcome;
      for (let transportAttempt = 1; ; transportAttempt++) {
        outcome = await transport.runPrompt({ agent: PLANNING_PROTOCOL_AGENT, prompt, cwd: process.cwd(), teamConfig, model: teamConfig.agents?.planner?.model });
        if (outcome.exitCode === 0) break;
        const failure = classifyProviderFailure({ provider, message: `Provider exited with code ${outcome.exitCode} while planning.`, exitCode: outcome.exitCode, stderr: outcome.stderr, stdout: outcome.stdout });
        diagnostics.push({ attempt, issue: `transport attempt ${transportAttempt}: ${failure.kind}`, stdoutPreview: safeDiagnostic(outcome.stdout), stderrPreview: safeDiagnostic(outcome.stderr) });
        await writeJson(diagnosticsFile, diagnostics);
        if (!failure.retryable || transportAttempt >= retry.max_attempts) {
          throw new Error(`Planner failed — ${describeProviderError(failure)}\nDiagnostics saved to: plans/${planId}/planner-diagnostics.json`);
        }
        const delayMs = calculateRetryDelay({ attempt: transportAttempt, baseDelayMs: retry.base_delay_ms, maxDelayMs: retry.max_delay_ms, retryAfterMs: failure.retryAfterMs, jitter: retry.jitter, random: options.random });
        options.onEvent?.(`Planner transport retry ${transportAttempt}/${retry.max_attempts} in ${delayMs}ms (${failure.kind})...`);
        await delay(delayMs);
      }
      rawText = extractTextEvents(outcome.stdout) || outcome.stdout;
      try {
        if (!rawText.trim()) throw new Error("no usable output");
        const parsed = await parsePlannerOutput(rawText, knownCapabilities);
        // Goal and workflow type originate in orchestration, not the model.
        // Validate the model's complete candidate first, then canonicalize only
        // those authoritative fields and validate the resulting plan again.
        const canonicalPlan: TaskGraphPlan = {
          ...parsed.plan,
          goal: originalRequest,
          workflow_type: options.type,
        };
        await validatePlannerPlanWithSchema(canonicalPlan, { knownCapabilities });
        rawPlan = parsed.raw;
        plannerResult = canonicalPlan;
        diagnostics.push({ attempt, stdoutPreview: safeDiagnostic(outcome.stdout), stderrPreview: safeDiagnostic(outcome.stderr) });
        break;
      } catch (error) {
        issue = error instanceof Error ? error.message : String(error);
        diagnostics.push({ attempt, issue: safeDiagnostic(issue, FEEDBACK_LIMIT), stdoutPreview: safeDiagnostic(outcome.stdout), stderrPreview: safeDiagnostic(outcome.stderr) });
        await writeFile(resolve(planDir, `planner-attempt-${attempt}.raw.txt`), safeDiagnostic(rawText, 32_000), "utf8");
      }
    }
    await writeJson(diagnosticsFile, diagnostics);
    if (diagnostics.at(-1)?.issue) throw new Error(`Planner recovery exhausted after 3 attempts: ${safeDiagnostic(issue, FEEDBACK_LIMIT)}. Diagnostics saved to: plans/${planId}/planner-diagnostics.json`);
  }
  const rawTextFile = resolve(planDir, "planner-result.raw.txt");
  const rawJsonFile = resolve(planDir, "planner-result.raw.json");
  await writeFile(rawTextFile, rawText, "utf8");
  if (rawPlan === undefined) throw new Error(`Could not parse planner output. Raw output saved to: plans/${planId}/planner-result.raw.txt`);
  await writeJson(rawJsonFile, rawPlan);
  plannerResult ??= (await parsePlannerOutput(rawText, knownCapabilities)).plan;
  const taskGraph = planToTaskGraph(plannerResult);
  const plannerFile = resolve(planDir, "planner-result.json");
  const graphFile = resolve(planDir, "task-graph.json");
  await writeJson(plannerFile, plannerResult); await writeJson(graphFile, taskGraph);
  return { planId, planDir, plannerResult, taskGraph, analysis: analyzeTaskGraph(taskGraph.tasks), artifactFiles: { plannerResult: plannerFile, taskGraph: graphFile, rawText: rawTextFile, rawJson: rawJsonFile, ...(!options.planFile ? { diagnostics: diagnosticsFile } : {}), ...(designArtifacts ? { designSpec: designArtifacts.file, designDiagnostics: designArtifacts.diagnosticsFile } : {}) } };
}
