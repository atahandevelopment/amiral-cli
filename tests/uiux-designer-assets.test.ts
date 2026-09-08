import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const read = (path: string): Promise<string> => readFile(resolve(root, path), "utf8");

describe("DESIGN-001 UI/UX designer assets", () => {
  it("keeps the canonical and initialized agent definitions identical", async () => {
    const [canonical, template] = await Promise.all([
      read(".opencode/agents/uiux-designer.md"),
      read("templates/init/.opencode/agents/uiux-designer.md"),
    ]);

    assert.equal(template, canonical);
    assert.match(canonical, /edit: deny/);
    assert.match(canonical, /bash: deny/);
    assert.match(canonical, /"ui-ux-pro": allow/);
    assert.match(canonical, /design-spec\.schema\.json/);
    assert.match(canonical, /Return one JSON object and no prose/);
  });

  it("ships all seven focused skill references", async () => {
    const names = [
      "spacing",
      "typography",
      "responsive",
      "motion",
      "interactions",
      "accessibility",
      "anti-patterns",
    ];
    const references = await Promise.all(
      names.map((name) => read(`vendor/skills/ui-ux-pro/references/${name}.md`)),
    );

    assert.equal(references.length, 7);
    references.forEach((reference) => assert.ok(reference.trim().length > 100));
    assert.match(references[6], /non-company product archetype/);
    assert.match(references[6], /no preset/i);
  });
});
