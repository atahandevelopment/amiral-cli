import type { FixTaskDraft, ReviewFinding } from "./review-fix-types.js";
import type { AgentName } from "./types.js";

function chooseAgent(finding: ReviewFinding): AgentName {
  const text = `${finding.file ?? ""} ${finding.issue} ${finding.recommendation ?? ""}`.toLowerCase();

  if (/(frontend|react|next|ui|css)/.test(text)) return "frontend";
  if (/(database|sql|migration|schema)/.test(text)) return "database";
  if (/(devops|docker|ci|deployment)/.test(text)) return "devops";
  return "backend";
}

function titleFrom(issue: string): string {
  const value = issue.replace(/\s+/g, " ").trim();
  return value.length <= 70 ? value : `${value.slice(0, 67)}...`;
}

export function createFixTasks(findings: ReviewFinding[], round: number): FixTaskDraft[] {
  return findings
    .map((finding, originalIndex) => ({ finding, originalIndex }))
    .filter(({ finding }) => finding.severity !== "SUGGESTION")
    .map(({ finding, originalIndex }, index) => {
      const id = `FIX-R${round}-${String(index + 1).padStart(3, "0")}`;
      const location = finding.file
        ? `\nAffected file: ${finding.file}${finding.line ? `:${finding.line}` : ""}`
        : "";

      return {
        id,
        title: `Fix review finding: ${titleFrom(finding.issue)}`,
        agent: chooseAgent(finding),
        description:
          `Resolve Reviewer finding from review round ${round}.${location}\n\n` +
          `Issue:\n${finding.issue}\n\nRecommendation:\n` +
          `${finding.recommendation ?? "Apply the smallest correct architectural fix."}`,
        dependencies: [],
        acceptance_criteria: [
          "The reported review finding is resolved.",
          "No unrelated behavior is changed.",
          "Relevant validation passes.",
          "The fix follows repository architecture and conventions."
        ],
        source_finding_indexes: [originalIndex]
      };
    });
}
