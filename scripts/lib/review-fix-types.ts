import type { AgentName } from "./types.js";

export type ReviewFinding = {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "SUGGESTION";
  file?: string;
  line?: number;
  issue: string;
  recommendation?: string;
};

export type ReviewGateResult = {
  workflow_id: string;
  gate: "review";
  status: "PASS" | "CHANGES_REQUESTED" | "BLOCKED";
  summary: string;
  findings: ReviewFinding[];
};

export type FixTaskDraft = {
  id: string;
  title: string;
  agent: AgentName;
  description: string;
  dependencies: string[];
  acceptance_criteria: string[];
  source_finding_indexes: number[];
};
