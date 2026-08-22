import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractJsonObject,
  extractTextEvents,
} from "../scripts/lib/providers/output-extraction.js";
import { createProtocolFailureResult } from "../scripts/lib/providers/opencode-provider.js";

describe("output-extraction (result recovery regression)", () => {
  it("joins text events from OpenCode JSON output", () => {
    const stdout = [
      'not json at all',
      '{"type":"text","part":{"type":"text","text":"line one"}}',
      '{"type":"other","part":{"type":"text","text":"ignored"}}',
      '{"type":"text","part":{"type":"text","text":"line two"}}',
    ].join("\n");

    assert.equal(extractTextEvents(stdout), "line oneline two");
  });

  it("joins fragmented JSON chunks while ignoring mixed logs", () => {
    const stdout = ['INFO starting','{"type":"text","part":{"type":"text","text":"{\\\"a\\\":"}}','noise','{"type":"text","part":{"type":"text","text":"1}"}}'].join("\n");
    assert.equal(extractTextEvents(stdout), '{"a":1}');
  });

  it("returns empty string when no text events exist", () => {
    assert.equal(extractTextEvents("garbage"), "");
    assert.equal(extractTextEvents(""), "");
  });

  it("recovers JSON from fenced code blocks", () => {
    const text = 'Here is the result:\n```json\n{"status":"completed"}\n```';

    assert.deepEqual(extractJsonObject(text), { status: "completed" });
  });

  it("recovers embedded JSON objects from raw prose", () => {
    const text =
      'The agent finished. Result: {"workflow_id":"w1","task_id":"T1"} thanks';

    assert.deepEqual(extractJsonObject(text), {
      workflow_id: "w1",
      task_id: "T1",
    });
  });

  it("parses raw JSON directly", () => {
    assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
  });

  it("returns null when no JSON can be recovered", () => {
    assert.equal(extractJsonObject("no structured data here"), null);
    assert.equal(extractJsonObject(""), null);
  });
});

describe("protocol failure fallback", () => {
  const request = {
    workflow_id: "wf-1",
    task_id: "API-001",
    lease_id: "lease-1",
    agent: "backend" as const,
    title: "t",
    description: "d",
    acceptance_criteria: ["c"],
    attempt: 1,
    max_attempts: 3,
    created_at: new Date().toISOString(),
    context: {
      workflow_type: "feature" as const,
      dependencies: [],
      skills: [],
      result_path: "tasks/wf-1/results/API-001.json",
    },
  };

  it("builds a failed AgentResult with diagnostic reason", () => {
    const fallback = createProtocolFailureResult(
      request,
      '{"type":"text","part":{"type":"text","text":"I forgot to write the file"}}',
    );

    assert.equal(fallback.status, "failed");
    assert.equal(fallback.workflow_id, request.workflow_id);
    assert.equal(fallback.task_id, request.task_id);
    assert.equal(fallback.lease_id, request.lease_id);
    assert.match(fallback.failure_reason ?? "", /Missing structured Agent Result/);
    assert.match(fallback.failure_reason ?? "", /I forgot to write the file/);
  });

  it("handles completely silent provider output", () => {
    const fallback = createProtocolFailureResult(request, "");

    assert.equal(fallback.status, "failed");
    assert.match(
      fallback.failure_reason ?? "",
      /no usable final provider response/,
    );
  });
});
