import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

describe("runtime-lock", () => {
  let root: string;
  let originalCwd: string;
  let api: typeof import("../scripts/lib/runtime-lock.js");

  before(async () => {
    originalCwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), "amiral-lock-"));
    process.chdir(root);
    api = await import("../scripts/lib/runtime-lock.js");
  });
  after(() => {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const lockPath = () => join(root, ".amiral", "amiral.lock");

  it("acquires, fsyncs JSON ownership, and releases", async () => {
    const handle = await api.acquireLock("run");
    const json = JSON.parse(readFileSync(handle.path, "utf8"));
    assert.deepEqual(Object.keys(json).sort(), ["command", "pid", "started_at", "token"]);
    assert.equal(json.token, handle.token);
    await api.releaseLock(handle);
    assert.equal(existsSync(handle.path), false);
  });

  it("rejects a live public lock", async () => {
    const handle = await api.acquireLock("run");
    await assert.rejects(() => api.acquireLock("resume"), api.LockError);
    await api.releaseLock(handle);
  });

  it("does not let an old handle release a same-pid token replacement", async () => {
    const handle = await api.acquireLock("run");
    writeFileSync(handle.path, JSON.stringify({ pid: handle.pid, token: "replacement", started_at: "x", command: "other" }));
    await api.releaseLock(handle);
    assert.equal(existsSync(handle.path), true);
    rmSync(handle.path);
  });

  function synchronizedContenders(id: string, count = 3): Promise<string[]> {
    const barrier = join(root, `barrier-${id}`);
    mkdirSync(barrier);
    const moduleUrl = pathToFileURL(join(originalCwd, "scripts", "lib", "runtime-lock.ts")).href;
    const tsx = pathToFileURL(createRequire(join(originalCwd, "package.json")).resolve("tsx")).href;
    const children: Array<Promise<string>> = [];
    for (let index = 0; index < count; index += 1) {
      const code = `import fs from 'node:fs';import path from 'node:path';import(${JSON.stringify(moduleUrl)}).then(async m=>{const b=${JSON.stringify(barrier)},id=${JSON.stringify(String(index))};fs.writeFileSync(path.join(b,'ready-'+id),'');while(!fs.existsSync(path.join(b,'go')))await new Promise(r=>setTimeout(r,5));try{const h=await m.acquireLock('child');console.log('HELD');await new Promise(r=>setTimeout(r,700));await m.releaseLock(h)}catch(e){if(e.name==='LockError'){console.log('BLOCKED');return}throw e}})`;
      children.push(new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", tsx, "--eval", code], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        child.stdout.on("data", (data) => stdout += data);
        child.stderr.on("data", (data) => stderr += data);
        child.on("error", reject);
        child.on("exit", (exitCode) => exitCode === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
      }));
    }
    return (async () => {
      const deadline = Date.now() + 5_000;
      while (Array.from({ length: count }, (_, index) => existsSync(join(barrier, `ready-${index}`))).some((ready) => !ready)) {
        if (Date.now() > deadline) throw new Error("children did not reach filesystem barrier");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      writeFileSync(join(barrier, "go"), "");
      return Promise.all(children);
    })();
  }

  it("allows exactly one synchronized contender for a fresh public lock", async () => {
    const results = await synchronizedContenders("fresh");
    assert.equal(results.filter((value) => value === "HELD").length, 1);
    assert.equal(results.filter((value) => value === "BLOCKED").length, 2);
  });

  for (const kind of ["dead", "corrupt"] as const) {
    it(`allows exactly one synchronized contender to take over a ${kind} public lock`, async () => {
      mkdirSync(join(root, ".amiral"), { recursive: true });
      writeFileSync(lockPath(), kind === "dead" ? JSON.stringify({ pid: 2_147_483_647, started_at: "x", command: "old" }) : "broken");
      const results = await synchronizedContenders(kind);
      assert.equal(results.filter((value) => value === "HELD").length, 1);
      assert.equal(results.filter((value) => value === "BLOCKED").length, 2);
    });
  }

  function spawnMutexOwner(readyFile: string): ChildProcess {
    const properLockfile = createRequire(join(originalCwd, "package.json")).resolve("proper-lockfile");
    const code = `const fs=require('node:fs'),lock=require(${JSON.stringify(properLockfile)});lock.lock(${JSON.stringify(lockPath())},{lockfilePath:${JSON.stringify(`${lockPath()}.guard`)},realpath:false,stale:2000,update:1000}).then(()=>{fs.writeFileSync(${JSON.stringify(readyFile)},'');setInterval(()=>{},1000)})`;
    return spawn(process.execPath, ["--eval", code], { cwd: root, stdio: "ignore" });
  }

  async function waitForFile(path: string): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (!existsSync(path)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it("never steals a live heartbeat acquisition mutex", async () => {
    mkdirSync(join(root, ".amiral"), { recursive: true });
    const ready = join(root, "mutex-live-ready");
    const owner = spawnMutexOwner(ready);
    await waitForFile(ready);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    await assert.rejects(() => api.acquireLock("blocked"), (error: unknown) => error instanceof api.LockError && !String(error).includes("ELOCKED"));
    owner.kill("SIGKILL");
    await new Promise<void>((resolve) => owner.once("exit", () => resolve()));
    // This test is about a live heartbeat, so clean up its deliberately killed
    // fixture rather than spending another stale interval here.
    rmSync(`${lockPath()}.guard`, { recursive: true, force: true });
  });

  it("automatically recovers a crashed acquisition mutex after its stale timeout", async () => {
    const ready = join(root, "mutex-crash-ready");
    const owner = spawnMutexOwner(ready);
    await waitForFile(ready);
    owner.kill("SIGKILL");
    await new Promise<void>((resolve) => owner.once("exit", () => resolve()));
    // proper-lockfile probes filesystem mtime precision and may round the
    // initial timestamp up by as much as one second.
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    const handle = await api.acquireLock("recovered");
    await api.releaseLock(handle);
  });
});
