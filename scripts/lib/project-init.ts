/**
 * Phase 14 STAGE 1b — Project initialization service.
 *
 * Copies the whitelisted init templates from templates/init/ into a target
 * project root. Full initialization also copies the packaged vendor/skills/
 * tree to vendor/skills/ in the target; minimal initialization does not read
 * or validate that tree.
 *
 *   team.yaml
 *   .opencode/opencode.json
 *   markdown files under .opencode/agents, .opencode/workflows,
 *     .opencode/contracts, .opencode/orchestration, .opencode/policies,
 *     .opencode/prompts
 *   JSON schemas under .opencode/schemas
 *
 * Excluded on purpose: node_modules, runtime state, package manifests.
 *
 * Safety rules:
 *   - existing files are NEVER overwritten unless force is set
 *   - .gitignore changes are always guarded by >>> Amiral <<< markers and
 *     never duplicated, regardless of force
 *   - this module NEVER runs `git init`; a missing repository only produces
 *     a warning step + gitWarning field
 *
 * The module never writes to the console and never exits the process; it
 * returns the deterministic list of steps for the CLI to render.
 */

import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";

export type InitStepAction = "created" | "exists" | "overwritten" | "warn";

export type InitStep = {
  action: InitStepAction;
  /** Path relative to the project root (posix separators). */
  path: string;
  detail?: string;
};

export type InitAmiralProjectResult = {
  steps: InitStep[];
  gitWarning?: string;
};

export type InitAmiralProjectOptions = {
  force?: boolean;
  minimal?: boolean;
  /** Target project root. Defaults to the current working directory. */
  root?: string;
};

/** Repository root that ships the templates (two levels up from here). */
const SOURCE_PACKAGE_ROOT = resolve(__dirname, "..", "..");
const PACKAGE_ROOT = existsSync(resolve(SOURCE_PACKAGE_ROOT, "templates", "init"))
  ? SOURCE_PACKAGE_ROOT
  : resolve(SOURCE_PACKAGE_ROOT, "..");

const TEMPLATE_ROOT = resolve(PACKAGE_ROOT, "templates", "init");
const VENDOR_SKILLS_ROOT = resolve(PACKAGE_ROOT, "vendor", "skills");

const GITIGNORE_MARKER_START = "# >>> Amiral >>>";
const GITIGNORE_MARKER_END = "# <<< Amiral <<<";

const GITIGNORE_BLOCK = [
  GITIGNORE_MARKER_START,
  "/tasks/*/",
  "/tasks/.active-workflow",
  "/.amiral/worktrees/",
  "/.amiral/integration/",
  "/plans/",
  "/.amiral/amiral.lock",
  GITIGNORE_MARKER_END,
  "",
].join("\n");

export type CollectedFile = {
  /** Posix path relative to the collected source root. */
  relativePath: string;
  absolutePath: string;
};

function toPosix(value: string): string {
  return value.split("\\").join("/");
}

/** Compare strings by Unicode code point, independent of the host locale. */
function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0)!);
  const rightPoints = Array.from(right, character => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }

  return leftPoints.length - rightPoints.length;
}

/**
 * Recursively collect regular files without following symlinks, sorted by
 * POSIX relative path so output order is stable across platforms.
 */
export async function collectFiles(sourceRoot: string): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];
  const rootInfo = await lstat(sourceRoot);
  if (rootInfo.isSymbolicLink()) {
    throw new Error(`Refusing to follow symbolic link source: ${sourceRoot}`);
  }
  if (!rootInfo.isDirectory()) {
    throw new Error(`File collection source is not a directory: ${sourceRoot}`);
  }

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries.sort((a, b) =>
      compareCodePoints(a.name, b.name),
    )) {
      const entryPath = join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        files.push({
          relativePath: toPosix(relative(sourceRoot, entryPath)),
          absolutePath: entryPath,
        });
      }
    }
  }

  await walk(sourceRoot);

  return files.sort((a, b) => compareCodePoints(a.relativePath, b.relativePath));
}

/** Minimal mode keeps essentials, including the machine planning agent. */
function isIncludedInMinimal(relativePath: string): boolean {
  return (
    relativePath === "team.yaml" ||
    relativePath === ".opencode/agents/planning-protocol.md" ||
    relativePath.startsWith(".opencode/schemas/") ||
    relativePath.startsWith(".opencode/workflows/")
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Refusing to use symbolic link destination: ${path}`);
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function assertTargetBeneathRoot(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Target escapes project root: ${target}`);
}

async function assertSafeTarget(root: string, target: string): Promise<void> {
  assertTargetBeneathRoot(root, target);
  const rel = relative(root, target);
  const parts = rel.split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Refusing to follow symbolic link in init target: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

/** True when any filesystem entry (file, directory, symlink) exists. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Copy one collected file beneath an optional POSIX destination prefix. */
export async function copyFileSafely(
  file: CollectedFile,
  targetRoot: string,
  force: boolean,
  destinationPrefix = "",
): Promise<InitStep> {
  const outputPath = [destinationPrefix, file.relativePath].filter(Boolean).join("/");
  const targetPath = resolve(targetRoot, ...outputPath.split("/"));
  await assertSafeTarget(targetRoot, targetPath);

  const exists = await fileExists(targetPath);

  if (exists && !force) {
    return { action: "exists", path: outputPath };
  }

  await mkdir(dirname(targetPath), { recursive: true });

  const content = await readFile(file.absolutePath);

  await writeFile(targetPath, content);

  return {
    action: exists ? "overwritten" : "created",
    path: outputPath,
  };
}

function gitignoreHasMarkers(content: string): boolean {
  return (
    content.includes(GITIGNORE_MARKER_START) &&
    content.includes(GITIGNORE_MARKER_END)
  );
}

/**
 * Marker-guarded .gitignore handling. Never duplicates the block and is
 * intentionally independent of force: user data outside the marker block
 * is never touched.
 */
async function ensureGitignore(
  targetRoot: string,
): Promise<InitStep> {
  const gitignorePath = resolve(targetRoot, ".gitignore");
  await assertSafeTarget(targetRoot, gitignorePath);

  let existing: string | null = null;

  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    // Missing .gitignore: create it with the marker block below.
  }

  if (existing !== null && gitignoreHasMarkers(existing)) {
    return {
      action: "exists",
      path: ".gitignore",
      detail: "Amiral block already present.",
    };
  }

  await mkdir(dirname(gitignorePath), { recursive: true });

  if (existing === null) {
    await writeFile(gitignorePath, GITIGNORE_BLOCK, "utf8");

    return {
      action: "created",
      path: ".gitignore",
      detail: "Created with the Amiral runtime ignore block.",
    };
  }

  const separator =
    existing.endsWith("\n") || existing.length === 0 ? "" : "\n";

  await writeFile(
    gitignorePath,
    `${existing}${separator}\n${GITIGNORE_BLOCK}`,
    "utf8",
  );

  return {
    action: "overwritten",
    path: ".gitignore",
    detail: "Appended the Amiral runtime ignore block.",
  };
}

/**
 * Initialize an Amiral project layout from the packaged templates.
 * Deterministic order: template files (sorted), then normal-mode vendor
 * skills (sorted), then .gitignore handling, then the optional git warning.
 */
export async function initAmiralProject(
  options: InitAmiralProjectOptions = {},
): Promise<InitAmiralProjectResult> {
  const requestedRoot = options.root ? resolve(options.root) : process.cwd();
  await mkdir(requestedRoot, { recursive: true });
  const root = await realpath(requestedRoot);

  const minimal = options.minimal === true;

  const steps: InitStep[] = [];

  const templates = await collectFiles(TEMPLATE_ROOT);

  // Preflight every packaged input before touching the target. In particular,
  // a broken package must not leave a partially initialized project behind.
  // Keep this branch wholly outside minimal mode: minimal initialization must
  // neither read nor validate the optional bundled skills tree.
  let skills: CollectedFile[] = [];
  if (!minimal) {
    try {
      skills = await collectFiles(VENDOR_SKILLS_ROOT);
    } catch (error) {
      throw new Error(
        `Cannot initialize bundled skills: the package is missing or has an invalid vendor/skills directory. Reinstall amiral-ai and try again.`,
        { cause: error },
      );
    }
  }

  for (const file of templates) {
    if (minimal && !isIncludedInMinimal(file.relativePath)) {
      continue;
    }

    steps.push(await copyFileSafely(file, root, options.force === true));
  }

  if (!minimal) {
    for (const file of skills) {
      steps.push(await copyFileSafely(file, root, options.force === true, "vendor/skills"));
    }
  }

  steps.push(await ensureGitignore(root));

  let gitWarning: string | undefined;

  if (!(await pathExists(resolve(root, ".git")))) {
    gitWarning =
      "The target directory is not a git repository. " +
      "Initialize git manually before running workflows " +
      "(Amiral never runs 'git init' for you).";

    steps.push({
      action: "warn",
      path: ".git",
      detail: gitWarning,
    });
  }

  return {
    steps,
    ...(gitWarning ? { gitWarning } : {}),
  };
}
