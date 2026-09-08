import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./cli-test-utils";

const run = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", ...env } });
const runNpm = (args: string[], cwd: string) => process.platform === "win32"
  ? run(process.execPath, [resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args], cwd)
  : run("npm", args, cwd);
const runShim = (shim: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => {
  if (process.platform !== "win32") return run(shim, args, cwd, env);
  return run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "call", shim, ...args], cwd, env);
};

test("packed CLI shims preserve requests through plan and run", { timeout: 120_000 }, async () => {
  const space = await mkdtemp(resolve(tmpdir(), "amiral-packed-consumer-"));
  try {
    const repositoryManifest = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
    const pack = runNpm(["pack", repoRoot, "--pack-destination", space, "--json"], space);
    assert.equal(pack.status, 0, pack.stderr);
    const packed = JSON.parse(pack.stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
    const paths = packed[0].files.map(file => file.path);
    assert.ok(paths.includes("dist/src/cli/index.js"));
    assert.ok(paths.includes("templates/init/.opencode/agents/lead.md"));
    assert.ok(paths.includes("templates/init/.opencode/agents/uiux-designer.md"));
    assert.ok(paths.includes("vendor/skills/ui-ux-pro/SKILL.md"));
    assert.ok(paths.includes("vendor/skills/using-agent-skills/SKILL.md"));
    for (const readme of ["README.md", "README_TR.md", "README_DE.md", "README_FR.md"]) assert.ok(paths.includes(readme));
    assert.ok(paths.every(path => !path.startsWith("vendor/addy-agent-skills/")));

    const install = runNpm(["install", "--ignore-scripts", resolve(space, packed[0].filename)], space);
    assert.equal(install.status, 0, install.stderr);
    const packageRoot = resolve(space, "node_modules", repositoryManifest.name);
    const installedManifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
    assert.equal(installedManifest.version, repositoryManifest.version);
    assert.deepEqual(installedManifest.bin, repositoryManifest.bin);

    const shim = resolve(space, "node_modules", ".bin", process.platform === "win32" ? "amiral.cmd" : "amiral");
    assert.equal(runShim(shim, ["--version"], space, {}).stdout.trim(), repositoryManifest.version);
    const init = runShim(shim, ["init"], space, {});
    assert.equal(init.status, 0, init.stderr);
    assert.deepEqual(
      await readFile(resolve(space, "vendor", "skills", "using-agent-skills", "SKILL.md")),
      await readFile(resolve(repoRoot, "vendor", "skills", "using-agent-skills", "SKILL.md")),
    );
    assert.deepEqual(
      await readFile(resolve(space, "vendor", "skills", "ui-ux-pro", "SKILL.md")),
      await readFile(resolve(repoRoot, "vendor", "skills", "ui-ux-pro", "SKILL.md")),
    );
    assert.ok((await readFile(resolve(space, ".opencode", "opencode.json"), "utf8")).includes('"vendor/skills"'));

    const minimalRoot = resolve(space, "minimal consumer");
    await mkdir(minimalRoot);
    const minimal = runShim(shim, ["init", "--minimal"], minimalRoot, {});
    assert.equal(minimal.status, 0, minimal.stderr);
    await assert.rejects(readFile(resolve(minimalRoot, "vendor", "skills", "using-agent-skills", "SKILL.md")), { code: "ENOENT" });

    const sourceLead = await readFile(resolve(repoRoot, ".opencode", "agents", "lead.md"));
    const templateLead = await readFile(resolve(repoRoot, "templates", "init", ".opencode", "agents", "lead.md"));
    const consumerLead = await readFile(resolve(space, ".opencode", "agents", "lead.md"));
    assert.deepEqual(sourceLead, templateLead);
    assert.deepEqual(consumerLead, templateLead);

    const capture = resolve(space, "planner-prompts.jsonl");
    const fakeJs = resolve(space, "fake-provider.cjs");
    await writeFile(fakeJs, `const args=process.argv.slice(1);if(args.includes("planning-protocol")){const fs=require("node:fs");const prompt=args.at(-1);fs.appendFileSync(process.env.AMIRAL_CAPTURE,JSON.stringify({mode:process.env.AMIRAL_MODE,prompt})+"\\n");if(process.env.AMIRAL_MODE==="run")process.stdout.write("not valid planner output");else{const plan={goal:"ignored",workflow_type:"bugfix",summary:"safe fix",tasks:[{id:"FIX-001",title:"Fix",agent:"backend",description:"Apply fix",dependencies:[],acceptance_criteria:["works"]}]};process.stdout.write(JSON.stringify(plan))}process.exit(0)}`);
    const teamPath = resolve(space, "team.yaml");
    const team = await readFile(teamPath, "utf8");
    await writeFile(teamPath, team.replace("binary: opencode", `binary: ${process.execPath.replaceAll("\\", "/")}`));

    const title = "Derived login title";
    const request = "Fix login while preserving 401 responses and redacting every token from diagnostics.";
    const commonEnv = { AMIRAL_CAPTURE: capture, NODE_OPTIONS: `--require=${fakeJs}` };
    const plan = runShim(shim, ["plan", title, "--type", "bugfix", "--request", request], space, { ...commonEnv, AMIRAL_MODE: "plan" });
    assert.equal(plan.status, 0, plan.stderr);
    const runResult = runShim(shim, ["run", title, "--type", "bugfix", "--request", request], space, { ...commonEnv, AMIRAL_MODE: "run" });
    assert.notEqual(runResult.status, null, runResult.stderr);

    const captures = (await readFile(capture, "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line) as { mode: string; prompt: string });
    for (const mode of ["plan", "run"]) {
      const prompts = captures.filter(item => item.mode === mode).map(item => item.prompt);
      assert.ok(prompts.length, `${mode} must invoke the provider through the installed CLI shim`);
      assert.ok(prompts.every(prompt => prompt.includes(request)), JSON.stringify({ mode, prompts }));
      assert.ok(prompts.every(prompt => !/Original User Request[^]*Derived login title/.test(prompt)));
    }

    await rm(resolve(packageRoot, "vendor", "skills"), { recursive: true, force: true });
    const minimalWithoutSkills = resolve(space, "minimal without package skills");
    await mkdir(minimalWithoutSkills);
    assert.equal(runShim(shim, ["init", "--minimal"], minimalWithoutSkills, {}).status, 0);
    const normalWithoutSkills = resolve(space, "normal without package skills");
    await mkdir(normalWithoutSkills);
    const missingSkills = runShim(shim, ["init"], normalWithoutSkills, {});
    assert.notEqual(missingSkills.status, 0);
    assert.match(missingSkills.stderr, /missing or has an invalid vendor\/skills.*Reinstall amiral-ai/i);
    assert.doesNotMatch(missingSkills.stderr, /ENOENT/);
    for (const output of ["team.yaml", ".opencode", ".gitignore", "vendor"]) {
      await assert.rejects(access(resolve(normalWithoutSkills, output)), { code: "ENOENT" });
    }
  } finally { await rm(space, { recursive: true, force: true, maxRetries: 3 }); }
});
