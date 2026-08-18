import spawn from "cross-spawn";
import { resolve } from "node:path";

const ROOT = process.cwd();

type GitResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runGit(args: string[], cwd = ROOT): Promise<GitResult> {
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

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type IntegrationWorkspace = {
  branchName: string;
  worktreePath: string;
};

export async function createIntegrationWorkspace(
  workflowId: string,
): Promise<IntegrationWorkspace> {
  const workflowSegment = sanitizeSegment(workflowId);

  const branchName = `amiral/${workflowSegment}/integration`;

  const worktreePath = resolve(ROOT, ".amiral", "integration", workflowSegment);

  const branchCheck = await runGit([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]);

  const existingWorktree = await runGit(["worktree", "list", "--porcelain"]);

  if (
    existingWorktree.stdout.includes(worktreePath.replace(/\\/g, "/")) ||
    existingWorktree.stdout.includes(worktreePath)
  ) {
    return {
      branchName,
      worktreePath,
    };
  }

  const args =
    branchCheck.code === 0
      ? ["worktree", "add", worktreePath, branchName]
      : ["worktree", "add", "-b", branchName, worktreePath, "HEAD"];

  const result = await runGit(args);

  if (result.code !== 0) {
    throw new Error(result.stderr || "Could not create integration worktree.");
  }

  return {
    branchName,
    worktreePath,
  };
}

export async function mergeTaskBranch(
  integrationWorktree: string,
  taskBranch: string,
): Promise<void> {
  const result = await runGit(
    ["merge", "--no-ff", "--no-edit", taskBranch],
    integrationWorktree,
  );

  if (result.code === 0) {
    return;
  }

  await runGit(["merge", "--abort"], integrationWorktree);

  throw new Error(
    result.stderr || `Merge conflict while merging "${taskBranch}".`,
  );
}

export async function getIntegrationStatus(
  integrationWorktree: string,
): Promise<string> {
  const result = await runGit(["status", "--short"], integrationWorktree);

  if (result.code !== 0) {
    throw new Error(result.stderr || "Could not inspect integration worktree.");
  }

  return result.stdout;
}

export function getTaskBranchName(workflowId: string, taskId: string): string {
  return `amiral/${sanitizeSegment(workflowId)}/${sanitizeSegment(taskId)}`;
}

export async function branchExists(branchName: string): Promise<boolean> {
  const result = await runGit([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]);

  return result.code === 0;
}
