import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

describe("planning service (offline)", async () => {
  const sourceRoot=process.cwd(); let root="";
  before(async()=>{root=await mkdtemp(resolve(tmpdir(),"amiral-planning-"));await cp(resolve(sourceRoot,"team.yaml"),resolve(root,"team.yaml"));await cp(resolve(sourceRoot,".opencode","schemas"),resolve(root,".opencode","schemas"),{recursive:true});await mkdir(resolve(root,"input"),{recursive:true});await cp(resolve(sourceRoot,"examples","planner-result.example.json"),resolve(root,"input","plan.json"));process.chdir(root);});
  after(()=>process.chdir(sourceRoot));
  it("persists canonical artifacts and returns analysis",async()=>{const s=await import("../scripts/lib/planning-service.js");const r=await s.planWorkflow({type:"feature",goal:"",planFile:"input/plan.json",name:"offline"});assert.ok(r.analysis.taskCount>0);assert.equal(JSON.parse(await readFile(r.artifactFiles.taskGraph,"utf8")).tasks.length,r.analysis.taskCount);assert.equal(JSON.parse(await readFile(r.artifactFiles.plannerResult,"utf8")).goal,r.plannerResult.goal);assert.equal(await s.resolvePlanReference(r.planId),r.artifactFiles.plannerResult);assert.equal(await s.resolvePlanReference(r.artifactFiles.taskGraph),r.artifactFiles.taskGraph);});
  it("rejects an invalid plan",async()=>{const s=await import("../scripts/lib/planning-service.js");const file=resolve(root,"input","invalid.json");await writeFile(file,'{"goal":"x","summary":"x","tasks":[]}');await assert.rejects(s.planWorkflow({type:"feature",goal:"",planFile:file}),/non-empty/);});
});
