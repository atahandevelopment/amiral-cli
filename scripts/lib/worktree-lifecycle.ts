import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import spawn from "cross-spawn";

import type { WorkflowState } from "./types.js";
import { loadState, listWorkflowIds } from "./workflow-store.js";

const ROOT = process.cwd();

export type CleanupPolicy = {
  cleanupCompleted: boolean;
  keepFailed: boolean;
  keepBlocked: boolean;
  keepBranches: boolean;
};

async function runGit(args: string[], cwd = ROOT) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({
      code: code ?? 1,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function directorySize(path: string): Promise<number> {
  if (!(await pathExists(path))) return 0;
  let total = 0;

  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) {
      try {
        total += (await stat(child)).size;
      } catch {}
    }
  }

  return total;
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getTaskWorktreePath(workflowId: string, taskId: string): string {
  return resolve(
    ROOT,
    ".amiral",
    "worktrees",
    sanitizeSegment(workflowId),
    sanitizeSegment(taskId),
  );
}

export function getTaskBranchName(workflowId: string, taskId: string): string {
  return `amiral/${sanitizeSegment(workflowId)}/${sanitizeSegment(taskId)}`;
}

export async function getWorktreeUsage() {
  const root = resolve(ROOT, ".amiral", "worktrees");
  if (!(await pathExists(root))) return [];

  const result: Array<{ path: string; bytes: number }> = [];

  for (const workflowEntry of await readdir(root, { withFileTypes: true })) {
    if (!workflowEntry.isDirectory()) continue;
    const workflowPath = resolve(root, workflowEntry.name);

    for (const taskEntry of await readdir(workflowPath, { withFileTypes: true })) {
      if (!taskEntry.isDirectory()) continue;
      const taskPath = resolve(workflowPath, taskEntry.name);
      result.push({ path: taskPath, bytes: await directorySize(taskPath) });
    }
  }

  return result;
}

export async function removeTaskWorktreeSafely(
  workflowId: string,
  taskId: string,
  keepBranch: boolean,
): Promise<void> {
  const worktreePath = getTaskWorktreePath(workflowId, taskId);
  const branchName = getTaskBranchName(workflowId, taskId);

  if (await pathExists(worktreePath)) {
    const result = await runGit(["worktree", "remove", "--force", worktreePath]);
    if (result.code !== 0) {
      throw new Error(result.stderr || `Could not remove worktree for ${taskId}.`);
    }
  }

  if (!keepBranch) {
    const result = await runGit(["branch", "-D", branchName]);
    if (result.code !== 0 && !result.stderr.includes("not found")) {
      throw new Error(result.stderr || `Could not delete branch ${branchName}.`);
    }
  }
}

export async function pruneGitWorktrees(): Promise<void> {
  const result = await runGit(["worktree", "prune"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "git worktree prune failed.");
  }
}

export async function cleanupWorkflow(
  state: WorkflowState,
  policy: CleanupPolicy,
): Promise<string[]> {
  const removed: string[] = [];

  for (const task of state.tasks) {
    const shouldRemove =
      (task.status === "completed" && policy.cleanupCompleted) ||
      (task.status === "failed" && !policy.keepFailed) ||
      (task.status === "blocked" && !policy.keepBlocked);

    if (!shouldRemove) continue;

    await removeTaskWorktreeSafely(
      state.workflow_id,
      task.id,
      policy.keepBranches,
    );
    removed.push(task.id);
  }

  await pruneGitWorktrees();
  return removed;
}

export async function cleanupAllWorkflows(policy: CleanupPolicy) {
  const result: Array<{ workflowId: string; removed: string[] }> = [];

  for (const workflowId of await listWorkflowIds()) {
    try {
      const state = await loadState(workflowId);
      result.push({
        workflowId,
        removed: await cleanupWorkflow(state, policy),
      });
    } catch {}
  }

  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }

  return `${value.toFixed(2)} ${unit}`;
}
