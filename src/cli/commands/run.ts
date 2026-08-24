import type { Command } from "commander";
import type { RunStopReason } from "../../../scripts/lib/orchestrator.js";
import { enterProjectContext, globalOptions } from "../context.js";
import { EXIT, UsageCliError } from "../errors.js";
import { Output } from "../ui/output.js";
import { planningOptionsFromCli } from "./plan.js";

const TYPES = ["feature", "bugfix", "refactor"] as const;

export function exitCodeForRunOutcome(reason: RunStopReason): number {
  switch (reason) {
    case "completed": case "retry_scheduled": return EXIT.SUCCESS;
    case "blocked": case "max_review_rounds": case "needs_input": return EXIT.WORKFLOW_BLOCKED;
    case "interrupted": return EXIT.INTERRUPTED;
    case "failed": case "no_progress": return EXIT.GENERAL;
  }
}

export function registerRun(program: Command): void {
  program.command("run [goal]").description("Plan, create, or resume and execute a workflow")
    .option("--plan <id-or-file>").option("--workflow <id>")
    .option("--type <type>", "feature, bugfix, or refactor", "feature")
    .option("--request <text>", "complete original request when goal is a short title")
    .option("--name <name>").option("--plan-file <file>").option("--json", "emit one JSON document")
    .action(async (goal, opts, cmd) => {
      if (!TYPES.includes(opts.type)) throw new UsageCliError("--type must be feature, bugfix, or refactor.");
      const modes = [Boolean(goal || opts.request || opts.planFile), Boolean(opts.plan), Boolean(opts.workflow)].filter(Boolean).length;
      if (modes > 1) throw new UsageCliError("Select only one of a goal/--plan-file, --plan, or --workflow.");
      await enterProjectContext();
      const out = new Output({ ...globalOptions(cmd), json: opts.json || globalOptions(cmd).json });
      const lock = await import("../../../scripts/lib/runtime-lock.js");
      const handle = await lock.acquireLock("run");
      const signal = { aborted: false };
      let signals = 0;
      const signalHandler = (): void => {
        signals += 1; signal.aborted = true;
        if (signals > 1) { try { process.stderr.write("Second signal received; terminating immediately.\n"); } finally { process.exit(EXIT.INTERRUPTED); } }
      };
      process.on("SIGINT", signalHandler); process.on("SIGTERM", signalHandler);
      let planId: string | undefined;
      try {
        const create = await import("../../../scripts/lib/workflow-create.js");
        const planning = await import("../../../scripts/lib/planning-service.js");
        let workflowId: string | undefined = opts.workflow;
        if (goal || opts.request || opts.planFile) {
          const plan = await planning.planWorkflow({ ...planningOptionsFromCli(goal, opts), onEvent: line => { if (out.options.verbose && !out.options.json) out.info(line); } });
          planId = plan.planId;
          workflowId = (await create.createWorkflowFromGraph({ type: plan.plannerResult.workflow_type ?? opts.type, graph: plan.taskGraph, graphSource: plan.artifactFiles.taskGraph, name: opts.name })).workflow_id;
        } else if (opts.plan) {
          const plan = await planning.analyzePlanFile(opts.plan);
          const source = await planning.resolvePlanReference(opts.plan);
          workflowId = (await create.createWorkflowFromGraph({ type: plan.plannerResult?.workflow_type ?? opts.type, graph: plan.taskGraph, graphSource: source, name: opts.name })).workflow_id;
        }
        const orchestrator = await import("../../../scripts/lib/orchestrator.js");
        const outcome = await orchestrator.runWorkflowUntilPause({ workflowId, signal, onEvent: line => { if (out.options.verbose && !out.options.json) out.info(line); } });
        const payload = { ...outcome, ...(planId ? { planId } : {}) };
        if (out.options.json) out.json(payload);
        else out.info(`${outcome.reason}: ${outcome.message}`);
        process.exitCode = exitCodeForRunOutcome(outcome.reason);
      } finally {
        process.off("SIGINT", signalHandler); process.off("SIGTERM", signalHandler);
        await lock.releaseLock(handle);
      }
    });
}
