import { access } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import type { Command } from "commander";
import { ConfigCliError } from "./errors.js";
export type GlobalOptions = { quiet?: boolean; verbose?: boolean; json?: boolean };
const exists = async (p: string) => { try { await access(p); return true; } catch { return false; } };
export async function findProjectRoot(startDir = process.cwd()): Promise<string | null> {
  let current = resolve(startDir); let secondary: string | null = null;
  while (true) {
    if (await exists(resolve(current, "team.yaml"))) return current;
    if (!secondary && ((await exists(resolve(current, ".amiral"))) || (await exists(resolve(current, ".opencode"))))) secondary = current;
    if (current === parse(current).root) return secondary;
    current = dirname(current);
  }
}
export async function enterProjectContext(startDir = process.cwd()) { const originalCwd = process.cwd(); const root = await findProjectRoot(startDir); if (!root) throw new ConfigCliError("No Amiral project found. Run amiral init in the project directory."); process.chdir(root); return { root, originalCwd }; }
export function globalOptions(command: Command): GlobalOptions { return command.optsWithGlobals() as GlobalOptions; }
export async function withProject<T>(fn: (root: string) => Promise<T>): Promise<T> { const { root } = await enterProjectContext(); return fn(root); }
export async function withLock<T>(command: string, fn: () => Promise<T>): Promise<T> { const lock = await import("../../scripts/lib/runtime-lock.js"); return lock.withLock(command, fn); }
