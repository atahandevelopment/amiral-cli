/** Read-only project diagnostics used by the doctor command. */
import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, resolve } from "node:path";
import { createRequire } from "node:module";
import spawn from "cross-spawn";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  loadTeamConfig,
  resolveExecutionConfig,
  resolveProviderConfig,
  resolveQualityConfig,
  type TeamConfig,
} from "./team-config.js";
import { getProviderCapacity } from "./provider-capacity.js";

export type DoctorCheckState = "ok" | "warn" | "fail";
export type DoctorCheck = {
  id: string;
  title: string;
  state: DoctorCheckState;
  detail?: string;
  hint?: string;
};

const root = () => process.cwd();
const check = (id: string, title: string, state: DoctorCheckState, detail?: string, hint?: string): DoctorCheck => ({
  id, title, state, ...(detail ? { detail } : {}), ...(hint ? { hint } : {}),
});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const exists = async (path: string) => { try { await stat(path); return true; } catch { return false; } };
const run = (binary: string, args: string[]) => spawn.sync(binary, args, { timeout: 10_000, encoding: "utf8" });

export async function resolveExecutable(binary: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const explicit = isAbsolute(binary) || binary.includes("/") || binary.includes("\\");
  const directories = explicit ? [""] : (env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" && !extname(binary)
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of directories) for (const extension of extensions) {
    const candidate = explicit ? resolve(binary) : resolve(directory, `${binary}${extension}`);
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      if (process.platform !== "win32") await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* try next candidate */ }
  }
  return null;
}

async function isolated(id: string, title: string, fn: () => Promise<DoctorCheck>): Promise<DoctorCheck> {
  try { return await fn(); } catch (error) { return check(id, title, "fail", message(error)); }
}

async function schemaCheck(): Promise<DoctorCheck> {
  const directory = resolve(root(), ".opencode", "schemas");
  const expected = ["agent-result.schema.json", "execution-request.schema.json", "planner-result.schema.json", "quality-gate.schema.json", "task.schema.json"];
  const missing = expected.filter((name) => !existsSync(resolve(directory, name)));
  if (missing.length) return check("schemas", "JSON schemas", "fail", `Missing: ${missing.join(", ")}`);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const schemas = await Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(directory, name), "utf8"))));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const schema of schemas) ajv.addSchema(schema);
  for (const schema of schemas) {
    if (typeof schema.$id === "string" && !ajv.getSchema(schema.$id)) throw new Error(`Could not compile ${schema.$id}`);
  }
  return check("schemas", "JSON schemas", "ok", `${names.length} schemas compiled.`);
}

async function gitText(args: string[]): Promise<string> {
  const result = run("git", args);
  if (result.error || result.status !== 0) throw result.error ?? new Error(String(result.stderr).trim() || "git failed");
  return String(result.stdout).trim();
}

export async function collectDoctorChecks(): Promise<{ checks: DoctorCheck[]; warnings: number; failures: number }> {
  let config: TeamConfig | undefined;
  const checks: DoctorCheck[] = [];
  checks.push(await isolated("node", "Node.js version", async () => {
    const major = Number(process.versions.node.split(".")[0]);
    return major >= 20 ? check("node", "Node.js version", "ok", process.version) : check("node", "Node.js version", "fail", `${process.version}; Node 20 or newer is required.`);
  }));
  for (const [id, title, binary] of [["npm", "npm availability", "npm"], ["git", "Git availability", "git"]] as const) {
    checks.push(await isolated(id, title, async () => { const result = run(binary, ["--version"]); return result.status === 0 ? check(id, title, "ok", String(result.stdout).trim()) : check(id, title, "fail", message(result.error ?? result.stderr)); }));
  }
  checks.push(await isolated("git-repository", "Git repository", async () => (await gitText(["rev-parse", "--is-inside-work-tree"])) === "true" ? check("git-repository", "Git repository", "ok") : check("git-repository", "Git repository", "warn", "Not inside a Git work tree.")));
  checks.push(await isolated("working-tree", "Working tree", async () => { const dirty = await gitText(["status", "--porcelain"]); return dirty ? check("working-tree", "Working tree", "warn", "Working tree has uncommitted changes.") : check("working-tree", "Working tree", "ok"); }));
  checks.push(await isolated("team-config", "team.yaml", async () => { config = await loadTeamConfig(); resolveExecutionConfig(config); resolveQualityConfig(config); for (const name of Object.keys(config.providers ?? {}).sort()) resolveProviderConfig(config, name); return check("team-config", "team.yaml", "ok"); }));
  checks.push(await isolated("provider-binaries", "Provider binaries", async () => {
    if (!config) return check("provider-binaries", "Provider binaries", "warn", "team.yaml could not be loaded.");
    const failures: string[] = [];
    for (const name of Object.keys(config.providers ?? {}).sort()) { const provider = resolveProviderConfig(config, name); if (provider.enabled && provider.binary && !(await resolveExecutable(provider.binary))) failures.push(`${name} (${provider.binary})`); }
    return failures.length ? check("provider-binaries", "Provider binaries", "warn", `Unavailable: ${failures.join(", ")}`) : check("provider-binaries", "Provider binaries", "ok");
  }));
  checks.push(await isolated("provider-capacity", "Provider capacity", async () => {
    if (!config) return check("provider-capacity", "Provider capacity", "warn", "team.yaml could not be loaded.");
    const details: string[] = [];
    for (const name of Object.keys(config.providers ?? {}).sort()) if (resolveProviderConfig(config, name).enabled) { const capacity = getProviderCapacity(config, name); details.push(`${name}: ${capacity.maxConcurrency}`); }
    return check("provider-capacity", "Provider capacity", "ok", details.join(", ") || "No explicitly configured providers.");
  }));
  checks.push(await isolated("opencode-directory", ".opencode directory", async () => await exists(resolve(root(), ".opencode")) ? check("opencode-directory", ".opencode directory", "ok") : check("opencode-directory", ".opencode directory", "warn", "Directory is missing.")));
  checks.push(await isolated("schemas", "JSON schemas", schemaCheck));
  checks.push(await isolated("active-workflow", "Active workflow pointer", async () => {
    const pointer = resolve(root(), "tasks", ".active-workflow");
    if (!await exists(pointer)) return check("active-workflow", "Active workflow pointer", "warn", "No active workflow.");
    const id = (await readFile(pointer, "utf8")).trim();
    return id && await exists(resolve(root(), "tasks", id, "state.json")) ? check("active-workflow", "Active workflow pointer", "ok", id) : check("active-workflow", "Active workflow pointer", "warn", `Pointer target is missing: ${id || "<empty>"}`);
  }));
  checks.push(await isolated("stale-worktrees", "Task worktrees", async () => { const path = resolve(root(), ".amiral", "worktrees"); if (!await exists(path)) return check("stale-worktrees", "Task worktrees", "warn", "Runtime worktree directory is absent."); const dirs = await readdir(path); return dirs.length ? check("stale-worktrees", "Task worktrees", "warn", `${dirs.length} worktree entries require inspection.`) : check("stale-worktrees", "Task worktrees", "ok"); }));
  checks.push(await isolated("orphan-branches", "Amiral task branches", async () => { const output = await gitText(["branch", "--format=%(refname:short)", "--no-merged"]); const branches = output.split(/\r?\n/).filter((v) => /^amiral\//.test(v)); return branches.length ? check("orphan-branches", "Amiral task branches", "warn", branches.join(", ")) : check("orphan-branches", "Amiral task branches", "ok"); }));
  checks.push(await isolated("runtime-directories", "Runtime directories", async () => { const missing: string[] = []; for (const dir of ["tasks", "plans", ".amiral"]) if (!await exists(resolve(root(), dir))) missing.push(dir); return missing.length ? check("runtime-directories", "Runtime directories", "warn", `Missing optional directories: ${missing.join(", ")}`) : check("runtime-directories", "Runtime directories", "ok"); }));
  checks.push(await isolated("node-modules", "node_modules", async () => await exists(resolve(root(), "node_modules")) ? check("node-modules", "node_modules", "ok") : check("node-modules", "node_modules", "warn", "Dependencies are not installed.")));
  checks.push(await isolated("typescript", "TypeScript resolvability", async () => { createRequire(resolve(root(), "package.json")).resolve("typescript"); return check("typescript", "TypeScript resolvability", "ok"); }));
  return { checks, warnings: checks.filter((item) => item.state === "warn").length, failures: checks.filter((item) => item.state === "fail").length };
}
