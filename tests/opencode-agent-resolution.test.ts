import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { initAmiralProject } from "../scripts/lib/project-init.js";

const hasOpenCode = spawnSync("opencode --version", { shell: true, encoding: "utf8", windowsHide: true }).status === 0;

describe("OpenCode agent and skill resolution",()=>{
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
  it("discovers the full-init UI designer and its single installed skill",{skip:!hasOpenCode},async()=>{
    const root=await mkdtemp(resolve(tmpdir(),"amiral-ui-resolution-"));
    try {
      await initAmiralProject({root});
      const agent=spawnSync("opencode debug agent uiux-designer",{cwd:root,shell:true,encoding:"utf8",windowsHide:true,timeout:30000});
      assert.equal(agent.status,0,agent.stderr);assert.match(agent.stdout,/UI\/UX designer responsible/);
      const skills=spawnSync("opencode debug skill",{cwd:root,shell:true,encoding:"utf8",windowsHide:true,timeout:30000});
      assert.equal(skills.status,0,skills.stderr);
      const discovered=JSON.parse(skills.stdout) as Array<{name:string;location:string}>;
      const matches=discovered.filter(skill=>skill.name==="ui-ux-pro");
      assert.equal(matches.length,1,skills.stdout);
      assert.match(matches[0]!.location,/vendor[\\/]skills[\\/]ui-ux-pro[\\/]SKILL\.md/);
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
