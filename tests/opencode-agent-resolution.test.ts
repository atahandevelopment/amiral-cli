import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { initAmiralProject } from "../scripts/lib/project-init.js";

const hasOpenCode = spawnSync("opencode --version", { shell: true, encoding: "utf8", windowsHide: true }).status === 0;

describe("OpenCode planning protocol agent resolution",()=>{
  it("resolves as primary without fallback and applies effective read-only permissions",{skip:!hasOpenCode},async()=>{
    const root=await mkdtemp(resolve(tmpdir(),"amiral-agent-resolution-"));
    try {
      await initAmiralProject({root,minimal:true});
      const result=spawnSync("opencode agent list",{cwd:root,shell:true,encoding:"utf8",windowsHide:true,timeout:30000});
      assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stderr,/falling back/i);
      const match=result.stdout.match(/planning-protocol \(primary\)([\s\S]*?)(?=\n[^\s].* \((?:primary|subagent|all)\)|$)/);
      assert.ok(match,"planning-protocol primary agent was not listed");const section=match[1];
      for(const permission of ["edit","bash","question","webfetch","websearch","skill","todowrite","lsp","doom_loop","plan_enter","plan_exit","task","external_directory"]){assert.match(section,new RegExp(`"permission": "${permission}"[\\s\\S]{0,160}"action": "deny"`));}
      for(const permission of ["read","glob","grep","list"]){assert.match(section,new RegExp(`"permission": "${permission}"[\\s\\S]{0,160}"action": "allow"`));}
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
