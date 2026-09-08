import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { materializeTaskArtifacts } from "../scripts/lib/dispatcher-service.js";
import type { ExecutionRequest } from "../scripts/lib/execution-request.js";
import { repoRoot } from "./cli-test-utils.js";

test("artifact materialization removes earlier copies when a later copy fails", async () => {
  const root = await mkdtemp(resolve(repoRoot, "plans", ".dispatcher-artifacts-"));
  const worktree = resolve(root, "worktree");
  const existing = resolve(root, "uiux-design-spec.json");
  const segment = root.split(/[\\/]/).at(-1);
  const existingRef = `plans/${segment}/uiux-design-spec.json`;
  const missingRef = `plans/${segment}-missing/uiux-design-spec.json`;
  const request = { workflow_id: "WF-ROLLBACK", context: { artifact_refs: [existingRef, missingRef] } } as ExecutionRequest;

  try {
    await mkdir(worktree);
    await writeFile(existing, "artifact");

    await assert.rejects(materializeTaskArtifacts(request, worktree), { code: "ENOENT" });
    assert.deepEqual(await readdir(resolve(worktree, ".amiral", "artifacts")), []);
    assert.deepEqual(request.context.artifact_refs, [existingRef, missingRef]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project files cannot be materialized, overwritten, or deleted as artifacts", async () => {
  const root = await mkdtemp(resolve(repoRoot, "plans", ".dispatcher-artifacts-"));
  const worktree = resolve(root, "worktree");
  const trackedReadme = resolve(worktree, "README.md");
  try {
    await mkdir(worktree);
    await writeFile(trackedReadme, "tracked content");
    const request = { workflow_id: "WF-README", context: { artifact_refs: ["README.md"] } } as ExecutionRequest;
    await assert.rejects(materializeTaskArtifacts(request, worktree), /outside approved artifact roots or has an unsupported type/);
    assert.equal(await readFile(trackedReadme, "utf8"), "tracked content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-basename artifacts receive stable collision-safe local references", async () => {
  const root = await mkdtemp(resolve(repoRoot, "plans", ".dispatcher-artifacts-"));
  const taskRoot = await mkdtemp(resolve(repoRoot, "tasks", ".dispatcher-artifacts-"));
  const worktree = resolve(root, "worktree");
  const segment = root.split(/[\\/]/).at(-1)!;
  const taskSegment = taskRoot.split(/[\\/]/).at(-1)!;
  const refs = [`plans/${segment}/uiux-design-spec.json`, `tasks/${taskSegment}/uiux-design-spec.json`];
  try {
    await mkdir(worktree);
    await writeFile(resolve(root, "uiux-design-spec.json"), "one");
    await writeFile(resolve(taskRoot, "uiux-design-spec.json"), "two");
    const request = { workflow_id: "WF-COLLISION", context: { artifact_refs: refs } } as ExecutionRequest;

    await materializeTaskArtifacts(request, worktree);

    assert.equal(new Set(request.context.artifact_refs).size, 2);
    for (const ref of request.context.artifact_refs!) assert.match(ref, /^\.amiral\/artifacts\/[a-f0-9]{16}-uiux-design-spec\.json$/);
    assert.deepEqual(await Promise.all(request.context.artifact_refs!.map(ref => readFile(resolve(worktree, ref), "utf8"))), ["one", "two"]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(taskRoot, { recursive: true, force: true });
  }
});

test("source-file symlinks cannot be materialized", async (t) => {
  const root = await mkdtemp(resolve(repoRoot, "plans", ".dispatcher-artifacts-"));
  const outside = resolve(root, "outside.json");
  const source = resolve(root, "uiux-design-spec.json");
  const segment = root.split(/[\\/]/).at(-1)!;
  try {
    await writeFile(outside, "outside");
    try {
      await symlink(outside, source, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES") return t.skip("OS permissions prevent file symlink creation");
      throw error;
    }
    const request = { workflow_id: "WF-SYMLINK", context: { artifact_refs: [`plans/${segment}/uiux-design-spec.json`] } } as ExecutionRequest;
    await assert.rejects(materializeTaskArtifacts(request, resolve(root, "worktree")), /regular non-symlink file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlinked or junction artifact parent directories cannot escape approved roots", async (t) => {
  const fixture = await mkdtemp(resolve(repoRoot, ".dispatcher-artifacts-"));
  const target = resolve(fixture, "outside");
  const worktree = resolve(fixture, "worktree");
  const segment = `.dispatcher-link-${process.pid}-${Date.now()}`;
  const linkedPlan = resolve(repoRoot, "plans", segment);
  try {
    await mkdir(target);
    await mkdir(worktree);
    await writeFile(resolve(target, "uiux-design-spec.json"), "outside");
    try {
      await symlink(target, linkedPlan, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES") return t.skip("OS permissions prevent directory link creation");
      throw error;
    }
    const request = { workflow_id: "WF-PARENT-LINK", context: { artifact_refs: [`plans/${segment}/uiux-design-spec.json`] } } as ExecutionRequest;
    await assert.rejects(materializeTaskArtifacts(request, worktree), /resolves outside its approved root/);
  } finally {
    await rm(linkedPlan, { recursive: true, force: true });
    await rm(fixture, { recursive: true, force: true });
  }
});
