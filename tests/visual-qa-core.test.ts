import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, it } from "node:test";
import {
  DEFAULT_UI_VIEWPORTS,
  resolveProjectUiConfig,
  type TeamConfig,
} from "../scripts/lib/team-config.js";

describe("CORE-001 UI configuration", () => {
  it("keeps visual QA disabled with stable defaults for legacy configs", () => {
    const value = resolveProjectUiConfig({});
    assert.equal(value.enabled, false);
    assert.equal(value.designer, "uiux-designer");
    assert.deepEqual(value.animation, { enabled: false, intensity: "none" });
    assert.deepEqual(value.allowed_hosts, []);
    assert.deepEqual(value.routes, { include: [], exclude: [] });
    assert.deepEqual(value.server, { startup_timeout_ms: 60_000, shutdown_timeout_ms: 10_000 });
    assert.equal(value.visual_qa.enabled, false);
    assert.equal(value.visual_qa.max_iterations, 2);
    assert.deepEqual(value.visual_qa.viewports, DEFAULT_UI_VIEWPORTS);
  });

  it("normalizes configured values without sharing viewport objects", () => {
    const config: TeamConfig = { ui: { visual_qa: {
      enabled: true,
      provider: " neutral-provider ",
      max_iterations: 4,
      viewports: [{ width: 800, height: 600 }],
    } } };
    const value = resolveProjectUiConfig(config);
    assert.deepEqual(value.visual_qa, {
      enabled: true,
      provider: "neutral-provider",
      max_iterations: 4,
      viewports: [{ width: 800, height: 600 }],
    });
    assert.notEqual(value.visual_qa.viewports, config.ui?.visual_qa?.viewports);
  });

  it("rejects invalid iteration and viewport values", () => {
    assert.throws(
      () => resolveProjectUiConfig({ ui: { visual_qa: { max_iterations: 0 } } }),
      /positive integer/,
    );
    assert.throws(
      () => resolveProjectUiConfig({ ui: { designer: "reviewer" } }),
      /reserved quality-gate/,
    );
    assert.throws(
      () => resolveProjectUiConfig({ ui: { allowed_hosts: [""] } }),
      /allowed_hosts/,
    );
    assert.throws(
      () => resolveProjectUiConfig({ ui: { visual_qa: { viewports: [{ width: 0, height: 1 }] } } }),
      /viewports\[0\]/,
    );
  });
});

describe("CORE-001 contracts", () => {
  it("accepts uiux-designer in execution and result contracts", async () => {
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    const execution = ajv.compile(JSON.parse(await readFile(resolve(".opencode/schemas/execution-request.schema.json"), "utf8")));
    assert.equal(execution({
      workflow_id: "w", task_id: "t", agent: "uiux-designer", title: "Design",
      description: "Create spec", acceptance_criteria: ["Valid"], lease_id: "l",
      attempt: 1, max_attempts: 1, created_at: "2026-09-08T00:00:00.000Z",
      context: { workflow_type: "feature", dependencies: [], result_path: "result.json" },
    }), true, JSON.stringify(execution.errors));
  });

  it("keeps Visual QA separate from reserved quality gate values", async () => {
    const schema = JSON.parse(await readFile(resolve(".opencode/schemas/quality-gate.schema.json"), "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    assert.equal(validate({ workflow_id: "w", gate: "visual-qa", status: "PASS", summary: "ok" }), false);
  });

  it("enforces strict design and Visual QA result schemas", async () => {
    const ajv = new Ajv2020({ strict: true });
    const [design, result] = await Promise.all(["design-spec", "visual-qa-result"].map(async name =>
      ajv.compile(JSON.parse(await readFile(resolve(`.opencode/schemas/${name}.schema.json`), "utf8")))));
    assert.equal(design({ version: 1, name: "App", summary: "UI", routes: [{ path: "/", description: "Home", acceptance_criteria: ["Responsive"] }] }), true);
    assert.equal(result({ status: "PASS", summary: "Matches", findings: [], startup_gate: { status: "PASS", summary: "Ready" }, residual_findings: 0 }), true);
    assert.equal(result({ status: "PASS", outcome_code: "passed", summary: "Matches", findings: [], startup_gate: { status: "PASS", summary: "Ready" }, residual_findings: 0 }), true);
    assert.equal(result({ status: "PASS", summary: "Matches", findings: [], startup_gate: { status: "FAIL", summary: "Not ready" }, residual_findings: 0 }), false);
    assert.equal(result({ status: "PASS", summary: "Matches", findings: [], startup_gate: { status: "PASS", summary: "Ready" }, residual_findings: 1 }), false);
    assert.equal(result({ status: "FAIL", summary: "Mismatch", findings: [], startup_gate: { status: "PASS", summary: "Ready" }, residual_findings: 1, extra: true }), false);
  });
});
