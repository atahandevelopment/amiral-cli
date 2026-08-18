import spawn from "cross-spawn";

type GitResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runGit(
  args: string[],
  cwd: string,
): Promise<GitResult> {
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

export type FinalizeResult = {
  changed: boolean;
  committed: boolean;
  commit?: string;
  status: string;
};

export async function finalizeTaskWorktree(
  worktreePath: string,
  workflowId: string,
  taskId: string,
  title: string,
): Promise<FinalizeResult> {
  const statusResult = await runGit(
    ["status", "--short"],
    worktreePath,
  );

  if (statusResult.code !== 0) {
    throw new Error(
      statusResult.stderr ||
        `Could not inspect worktree for ${taskId}.`,
    );
  }

  if (!statusResult.stdout) {
    return {
      changed: false,
      committed: false,
      status: "",
    };
  }

  const addResult = await runGit(
    ["add", "--all"],
    worktreePath,
  );

  if (addResult.code !== 0) {
    throw new Error(
      addResult.stderr ||
        `Could not stage changes for ${taskId}.`,
    );
  }

  const message =
    `amiral(${taskId}): ${title}`;

  const commitResult = await runGit(
    [
      "commit",
      "-m",
      message,
      "-m",
      `Workflow: ${workflowId}`,
      "-m",
      `Task: ${taskId}`,
    ],
    worktreePath,
  );

  if (commitResult.code !== 0) {
    throw new Error(
      commitResult.stderr ||
        `Could not commit changes for ${taskId}.`,
    );
  }

  const headResult = await runGit(
    ["rev-parse", "HEAD"],
    worktreePath,
  );

  if (headResult.code !== 0 || !headResult.stdout) {
    throw new Error(
      headResult.stderr ||
        `Could not resolve task commit for ${taskId}.`,
    );
  }

  return {
    changed: true,
    committed: true,
    commit: headResult.stdout,
    status: statusResult.stdout,
  };
}
