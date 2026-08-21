import type { Command } from "commander"; import { globalOptions } from "../context.js"; import { Output } from "../ui/output.js";
export function registerInit(program: Command) { program.command("init").description("Initialize Amiral in the current directory").option("--force", "overwrite template files").option("--minimal", "install only essential files").action(async (opts, cmd) => {
  const output = new Output(globalOptions(cmd)); const service = await import("../../../scripts/lib/project-init.js"); const result = await service.initAmiralProject({ root: process.cwd(), force: opts.force, minimal: opts.minimal });
  if (output.options.json) return output.json(result); for (const step of result.steps) (step.action === "warn" ? output.warn.bind(output) : output.info.bind(output))(`${step.action}: ${step.path}${step.detail ? ` — ${step.detail}` : ""}`); output.success("Amiral project initialized.");
}); }
