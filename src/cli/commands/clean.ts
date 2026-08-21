import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { enterProjectContext, globalOptions, withLock } from "../context.js";
import { UsageCliError } from "../errors.js";
import { Output } from "../ui/output.js";

async function approval(force: boolean): Promise<void> {
  if (force) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new UsageCliError("Cleanup execution requires --force in non-TTY mode.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!/^y(es)?$/i.test(await prompt.question("Execute cleanup? [y/N] "))) throw new UsageCliError("Cancelled.");
  } finally { prompt.close(); }
}

export function registerClean(program: Command): void {
  program.command("clean").description("Preview or remove task worktrees conservatively")
    .option("--workflow <id>").option("--all").option("--completed")
    .option("--remove-failed").option("--remove-blocked").option("--delete-branches")
    .option("--dry-run").option("--force").action(async (opts, cmd) => {
      await enterProjectContext();
      if (opts.all && opts.workflow) throw new UsageCliError("Use either --all or --workflow, not both.");
      const out = new Output(globalOptions(cmd));
      const selectedPolicy = {
        completed: Boolean(opts.completed),
        failed: Boolean(opts.removeFailed),
        blocked: Boolean(opts.removeBlocked),
        branches: Boolean(opts.deleteBranches),
      };
      const hasCleanupSelector = Object.values(selectedPolicy).some(Boolean);
      const effectiveDryRun = Boolean(opts.dryRun) || !hasCleanupSelector;
      const policy = {
        cleanupCompleted: selectedPolicy.completed || !hasCleanupSelector,
        keepFailed: !selectedPolicy.failed,
        keepBlocked: !selectedPolicy.blocked,
        keepBranches: !selectedPolicy.branches,
      };
      const lifecycle = await import("../../../scripts/lib/worktree-lifecycle.js");
      const store = await import("../../../scripts/lib/workflow-store.js");
      const usage = await lifecycle.getWorktreeUsage();
      const plan = { scope: opts.all ? "all" : opts.workflow ?? "active", selectedPolicy, effectiveDryRun, worktrees: usage };
      if (effectiveDryRun) {
        if (out.options.json) out.json(plan);
        else { out.info("Preview only; no files will be deleted."); out.table(["PATH", "BYTES"], usage.map(x => [x.path, x.bytes])); }
        return;
      }
      await approval(Boolean(opts.force));
      if (!out.options.json) out.info("Executing cleanup.");
      const execute = async () => opts.all
        ? lifecycle.cleanupAllWorkflows(policy)
        : [{ workflowId: (await store.loadState(opts.workflow)).workflow_id, removed: await lifecycle.cleanupWorkflow(await store.loadState(opts.workflow), policy) }];
      const result = await withLock("clean", execute);
      const value = { ...plan, result };
      if (out.options.json) out.json(value);
      else out.success(`Cleanup complete: ${result.reduce((n, x) => n + x.removed.length, 0)} worktree(s) removed.`);
    });
}
