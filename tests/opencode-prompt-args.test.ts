import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOpenCodePromptArgs, OpenCodeProvider } from "../scripts/lib/providers/opencode-provider.js";
import type { TeamConfig } from "../scripts/lib/team-config.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

describe("OpenCode prompt arguments",()=>{
  it("places agent options before the variadic message positional",()=>{
    const args=buildOpenCodePromptArgs({agent:"planning-protocol",prompt:"plan this",cwd:"C:\\repo",teamConfig:{} as TeamConfig},"provider/model",true);
    assert.deepEqual(args,["run","--agent","planning-protocol","--dir","C:\\repo","--format","json","--model","provider/model","--auto","plan this"]);
    assert.ok(args.indexOf("--agent")<args.indexOf("plan this"));
  });
  it("runPrompt uses the ordered builder arguments on the spawned command",async()=>{
    const root=await mkdtemp(resolve(tmpdir(),"amiral-opencode-args-"));const capture=resolve(root,"args.json");
    await writeFile(resolve(root,"fake.js"),`require('fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));process.stdout.write('ok')`);
    const command=resolve(root,"fake.cmd");await writeFile(command,`@echo off\r\nnode "%~dp0fake.js" %*\r\n`);
    const config={providers:{opencode:{binary:command,max_concurrency:1}}} as unknown as TeamConfig;
    const result=await new OpenCodeProvider().runPrompt({agent:"planning-protocol",prompt:"MESSAGE",cwd:root,teamConfig:config});
    assert.equal(result.exitCode,0);const args=JSON.parse(await readFile(capture,"utf8")) as string[];
    assert.deepEqual(args,["run","--agent","planning-protocol","--dir",root,"--format","json","MESSAGE"]);
  });
});
