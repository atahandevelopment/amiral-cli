import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveExecutable } from "../scripts/lib/doctor-service.js";

test("provider executable detection never executes the candidate", async () => {
  const root=mkdtempSync(join(tmpdir(),"amiral-doctor-bin-"));
  const name=process.platform==="win32"?"fake-provider.cmd":"fake-provider";
  const binary=join(root,name), sentinel=join(root,"executed");
  try { writeFileSync(binary,process.platform==="win32"?`@echo x>"${sentinel}"\r\n`:`#!/bin/sh\ntouch "${sentinel}"\n`); if(process.platform!=="win32")chmodSync(binary,0o755); assert.equal(await resolveExecutable(name,{...process.env,PATH:[root,process.env.PATH??""].join(delimiter)}),binary); assert.equal(await resolveExecutable(binary),binary); assert.equal(require("node:fs").existsSync(sentinel),false); } finally { rmSync(root,{recursive:true,force:true}); }
});
