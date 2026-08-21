#!/usr/bin/env node

import {
  runQaGate,
  runReviewGate,
  type GateType,
  type QualityGateFinding,
} from "./lib/gates-service.js";

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function printGateOutcome(
  gate: GateType,
  status: string,
  summary: string,
  findings: QualityGateFinding[],
): void {
  console.log("");
  console.log(`✅ ${gate.toUpperCase()} gate: ${status}`);
  console.log(summary);

  if (findings.length) {
    console.log("");
    console.log("Findings:");

    for (const finding of findings) {
      const location = finding.file
        ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})`
        : "";

      console.log(`- [${finding.severity}] ${finding.issue}${location}`);

      if (finding.recommendation) {
        console.log(`  Recommendation: ${finding.recommendation}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const [gateArg, workflowIdArg] = process.argv.slice(2);

  if (gateArg !== "review" && gateArg !== "qa") {
    fail(
      "Usage: npx tsx scripts/run-quality-gate.ts <review|qa> [workflow-id]",
    );
  }

  const gate = gateArg as GateType;

  try {
    if (gate === "review") {
      const result = await runReviewGate({
        workflowId: workflowIdArg,
        onEvent: (line) => console.log(line),
      });

      printGateOutcome(gate, result.verdict, result.summary, result.findings);

      if (result.verdict !== "PASS") {
        console.log("");
        console.log("⛔ QA must not run until Review returns PASS.");
      }

      return;
    }

    const result = await runQaGate({
      workflowId: workflowIdArg,
      onEvent: (line) => console.log(line),
    });

    printGateOutcome(gate, result.verdict, result.summary, result.findings);

    if (result.workflowCompleted) {
      console.log("");
      console.log(`✅ Workflow ${result.workflowId} completed.`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
