import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import type { ExecutionProvider, PromptTransportInput, PromptTransportProvider } from "../scripts/lib/providers/provider.js";
import type { VisualQAResult } from "../scripts/lib/visual-qa.js";

describe("orchestrator", { concurrency: false }, () => {
  let root: string; let cwd: string; let create: typeof import("../scripts/lib/workflow-create.js").createWorkflowFromGraph; let run: typeof import("../scripts/lib/orchestrator.js").runWorkflowUntilPause; let register: typeof import("../scripts/lib/providers/provider-registry.js").registerProvider; let ProviderError: typeof import("../scripts/lib/providers/provider-error.js").ProviderError;
  let reviewStatus: "PASS" | "CHANGES_REQUESTED" = "PASS"; let failOnce = false; let genericFailOnce=false; let gateOrder: string[] = [];
  before(async () => {
    cwd = process.cwd(); root = mkdtempSync(join(tmpdir(), "amiral-orchestrator-")); process.chdir(root);
    execFileSync("git", ["init"]); execFileSync("git", ["config", "user.email", "test@example.com"]); execFileSync("git", ["config", "user.name", "Test"]); writeFileSync("README.md", "test\n"); execFileSync("git", ["add", "."]); execFileSync("git", ["commit", "-m", "initial"]);
    const init = await import("../scripts/lib/project-init.js"); await init.initAmiralProject({ root }); execFileSync("git", ["add", "."]); execFileSync("git", ["commit", "-m", "amiral"]);
    ({ createWorkflowFromGraph: create } = await import("../scripts/lib/workflow-create.js")); ({ runWorkflowUntilPause: run } = await import("../scripts/lib/orchestrator.js")); ({ registerProvider: register } = await import("../scripts/lib/providers/provider-registry.js")); ({ ProviderError } = await import("../scripts/lib/providers/provider-error.js"));
    const fake: ExecutionProvider & PromptTransportProvider = { name: "fake", getCapacity: () => ({ provider: "fake", maxConcurrency: 2 }), execute: async ({ request }) => { if(genericFailOnce){genericFailOnce=false;throw new Error("generic execution boom");} if (failOnce) { failOnce = false; throw new ProviderError({ message: "down", provider: "fake", kind: "unavailable", retryable: true, retryAfterMs: 1 }); } return { result: { workflow_id: request.workflow_id, task_id: request.task_id, lease_id: request.lease_id, agent: request.agent, status: "completed", summary: "done", files_changed: [] } }; }, runPrompt: async ({ agent, cwd: gateCwd }: PromptTransportInput) => { const gate = agent === "reviewer" ? "review" : "qa"; gateOrder.push(gate); const status = gate === "review" ? reviewStatus : "PASS"; const findings = status === "CHANGES_REQUESTED" ? [{ severity: "HIGH", issue: "Fix issue", file: "README.md", recommendation: "fix it" }] : []; mkdirSync(join(gateCwd, ".amiral", "gates"), { recursive: true }); writeFileSync(join(gateCwd, ".amiral", "gates", `${gate}-result.json`), JSON.stringify({ workflow_id: activeId, gate, status, summary: status, findings })); return { exitCode: 0, stdout: "", stderr: "" }; } }; register(fake);
  });
  after(async () => { const listing = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" }); for (const path of listing.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9)).filter((path) => path !== root.replace(/\\/g, "/") && path !== root)) { try { execFileSync("git", ["worktree", "remove", "--force", path]); } catch {} } try { execFileSync("git", ["worktree", "prune"]); } catch {} process.chdir(cwd); for (let attempt = 0; attempt < 5; attempt += 1) { try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); return; } catch (error) { if (attempt === 4) return; await new Promise((resolve) => setTimeout(resolve, 200)); } } });
  let activeId = "";
  async function workflow(name: string) { writeFileSync("team.yaml", `execution:\n  default_provider: fake\n  max_parallel_agents: 2\nproviders:\n  fake:\n    enabled: true\n    max_concurrency: 2\n    retry:\n      max_attempts: 3\n      base_delay_ms: 1\n      max_delay_ms: 1\n      jitter: false\nquality:\n  max_review_rounds: 1\n`); execFileSync("git", ["add", "team.yaml"]); execFileSync("git", ["commit", "--allow-empty", "-m", `config ${name}`]); const state = await create({ type: "feature", name, graphSource: "test", graph: { tasks: [{ id: "T1", title: "Tiny", agent: "backend", description: "tiny", dependencies: [], acceptance_criteria: ["done"] }] } }); activeId = state.workflow_id; return state; }
  it("reaches review PASS, QA PASS, and completion", async () => { const state = await workflow("pass"); reviewStatus = "PASS"; const outcome = await run({ workflowId: state.workflow_id }); assert.equal(outcome.reason, "completed"); assert.equal(outcome.status, "completed"); });
  it("schedules and resumes a retryable provider failure", async () => { const state = await workflow("retry"); reviewStatus = "PASS"; failOnce = true; const paused = await run({ workflowId: state.workflow_id }); assert.equal(paused.reason, "retry_scheduled"); const store = await import("../scripts/lib/workflow-store.js"); const persisted = await store.loadState(state.workflow_id); persisted.tasks[0]!.retry_not_before = new Date(0).toISOString(); await store.saveState(persisted); assert.equal((await run({ workflowId: state.workflow_id })).reason, "completed"); });
  it("blocks after maximum review rounds", async () => { const state = await workflow("changes"); reviewStatus = "CHANGES_REQUESTED"; const outcome = await run({ workflowId: state.workflow_id }); assert.equal(outcome.reason, "max_review_rounds"); assert.equal(outcome.status, "blocked"); });
  it("persists and reports a generic orchestration failure",async()=>{const state=await workflow("generic-failure");genericFailOnce=true;const outcome=await run({workflowId:state.workflow_id});assert.equal(outcome.reason,"failed");const store=await import("../scripts/lib/workflow-store.js");const persisted=await store.loadState(state.workflow_id);assert.equal(persisted.tasks[0].status,"failed");assert.equal(persisted.tasks[0].lease_id,null);assert.equal(persisted.tasks[0].started_at,null);assert.match(persisted.tasks[0].last_error??"",/generic execution boom/);assert.ok((await store.loadHistory(state.workflow_id)).some(event=>event.event==="task_status_changed"&&event.task_id==="T1"));});
  it("runs Visual QA fixes before Reviewer/QA, reintegrates, and stops at configured iterations", async () => {
    const state = await workflow("visual-loop");
    reviewStatus = "PASS";
    writeFileSync("uiux-design-spec.json", JSON.stringify({ version: 1, name: "UI", summary: "spec", routes: [{ path: "/", description: "Home", acceptance_criteria: ["Responsive"] }] }));
    const store = await import("../scripts/lib/workflow-store.js");
    const persisted = await store.loadState(state.workflow_id);
    persisted.tasks[0]!.agent = "frontend";
    persisted.tasks[0]!.artifact_refs = ["uiux-design-spec.json"];
    await store.saveState(persisted);
    writeFileSync("team.yaml", `execution:\n  default_provider: fake\nproviders:\n  fake:\n    enabled: true\nui:\n  enabled: true\n  server:\n    ready_url: http://localhost:3000\n  visual_qa:\n    enabled: true\n    provider: fake-visual\n    max_iterations: 2\n`);
    execFileSync("git", ["add", "team.yaml", "uiux-design-spec.json"]);
    execFileSync("git", ["commit", "-m", "visual test config"]);
    let evaluations = 0;
    const visualQAService = { evaluate: async (): Promise<VisualQAResult> => {
      evaluations++;
      return { status: "FAIL", summary: "overlap", findings: [{ severity: "high", message: "Header overlaps", route: "/" }], startup_gate: { status: "PASS", summary: "ready" }, residual_findings: 1 };
    } };
    gateOrder = [];
    const events: string[] = [];
    const outcome = await run({ workflowId: state.workflow_id, visualQAService, onEvent: line => events.push(line) });
    assert.equal(outcome.reason, "blocked");
    assert.equal(evaluations, 2);
    assert.deepEqual(gateOrder, []);
    assert.ok(events.some(line => line.includes("maximum iterations")));
    const final = await store.loadState(state.workflow_id);
    const fix = final.tasks.find(task => task.id === "FIX-VQA-R1-001");
    assert.equal(fix?.agent, "frontend");
    assert.deepEqual(fix?.artifact_refs, [resolve(root, "uiux-design-spec.json"), ".amiral/gates/visual-qa-iteration-1.json"]);
    const graph = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, "tasks", state.workflow_id, "task-graph.json"), "utf8"));
    assert.equal(graph.tasks.some((task: { id: string }) => task.id.startsWith("FIX-VQA")), false);
    const residual = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".amiral", "integration", state.workflow_id.toLowerCase(), ".amiral", "gates", "visual-qa-result.json"), "utf8"));
    assert.equal(residual.residual_findings, 1);
  });
});
