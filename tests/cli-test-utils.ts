import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const repoRoot = resolve(__dirname, "..");
export const sourceCli = resolve(repoRoot, "src", "cli", "index.ts");
export const tsxLoader = pathToFileURL(resolve(repoRoot, "node_modules", "tsx", "dist", "loader.mjs")).href;

export function cli(args: string[], cwd = repoRoot) {
  return spawnSync(process.execPath, ["--import", tsxLoader, sourceCli, ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

export async function tempSpace(prefix: string) { return mkdtemp(resolve(tmpdir(), `amiral ${prefix} `)); }
export async function cleanup(path: string) {
  for (let attempt = 0; attempt < 5; attempt++) try { await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); return; } catch { await new Promise(r => setTimeout(r, 50 * (attempt + 1))); }
}

export function git(cwd: string, ...args: string[]) { return spawnSync("git", args, { cwd, encoding: "utf8" }); }
