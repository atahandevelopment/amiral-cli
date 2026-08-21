import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import spawn from "cross-spawn";

const ROOT = process.cwd();

export type WorktreeInfo = {
  taskId: string;
  workflowId: string;
  branchName: string;
  worktreePath: string;
};

export function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function runGit(
  args: string[],
  cwd = ROOT,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);

    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
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

export async function assertGitRepository(): Promise<void> {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"]);

  if (result.code !== 0 || result.stdout !== "true") {
    throw new Error("Current directory is not a Git work tree.");
  }
}

export async function assertCleanWorkingTree(): Promise<void> {
  const result = await runGit(["status", "--porcelain"]);

  if (result.code !== 0) {
    throw new Error(result.stderr || "Could not inspect Git working tree.");
  }

  if (result.stdout) {
    throw new Error(
      "Main working tree is not clean. Commit, stash, or remove local changes before creating isolated task worktrees.",
    );
  }
}

export async function getCurrentCommit(): Promise<string> {
  const result = await runGit(["rev-parse", "HEAD"]);

  if (result.code !== 0 || !result.stdout) {
    throw new Error(result.stderr || "Could not resolve current commit.");
  }

  return result.stdout;
}

export async function createTaskWorktree(
  workflowId: string,
  taskId: string,
  baseRef: string = "HEAD",
): Promise<WorktreeInfo> {
  await assertGitRepository();

  const workflowSegment = sanitizeSegment(workflowId);
  const taskSegment = sanitizeSegment(taskId);

  const branchName = `amiral/${workflowSegment}/${taskSegment}`;

  const worktreePath = resolve(
    ROOT,
    ".amiral",
    "worktrees",
    workflowSegment,
    taskSegment,
  );

  if (await pathExists(worktreePath)) {
    return {
      taskId,
      workflowId,
      branchName,
      worktreePath,
    };
  }

  await mkdir(resolve(ROOT, ".amiral", "worktrees", workflowSegment), {
    recursive: true,
  });

  const branchCheck = await runGit([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]);

  const args =
    branchCheck.code === 0
      ? ["worktree", "add", worktreePath, branchName]
      : ["worktree", "add", "-b", branchName, worktreePath, baseRef];

  const result = await runGit(args);

  if (result.code !== 0) {
    throw new Error(
      result.stderr || `Could not create worktree for ${taskId}.`,
    );
  }

  return {
    taskId,
    workflowId,
    branchName,
    worktreePath,
  };
}

export async function getWorktreeDiff(worktreePath: string): Promise<string> {
  const result = await runGit(["status", "--short"], worktreePath);

  if (result.code !== 0) {
    throw new Error(result.stderr || "Could not inspect worktree diff.");
  }

  return result.stdout;
}

export async function removeTaskWorktree(worktreePath: string): Promise<void> {
  const result = await runGit(["worktree", "remove", worktreePath]);

  if (result.code !== 0) {
    throw new Error(result.stderr || "Could not remove worktree.");
  }
}
