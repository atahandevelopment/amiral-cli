import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PlaywrightVisualQAProvider } from "../scripts/lib/providers/playwright-visual-qa.js";
import { LocalNavigationPolicy } from "../scripts/lib/visual-qa.js";

describe("optional Playwright Visual QA adapter", () => {
  it("captures screenshots and emits deterministic rendered findings", async () => {
    let closed = 0;
    const provider = new PlaywrightVisualQAProvider(async () => ({ chromium: { launch: async () => ({
      newPage: async () => ({ route: async () => {}, setViewportSize: async () => {}, goto: async () => ({ status: () => 200, url: () => "http://localhost:1/" }), title: async () => "", locator: () => ({ isVisible: async () => true }), evaluate: async () => ({ width: 900, client: 800, text: 4 }), screenshot: async ({ path }) => { await import("node:fs/promises").then(fs => fs.writeFile(path, "png")); } }),
      close: async () => { closed++; },
    }) } }));
    const artifacts = await mkdtemp(join(tmpdir(), "amiral-vqa-"));
    const result = await provider.evaluate({ base_url: "http://localhost:1", design_spec: { version: 1, name: "x", summary: "x", routes: [{ path: "/", description: "x", acceptance_criteria: [] }] }, viewports: [{ width: 800, height: 600 }], artifact_dir: artifacts, navigation_policy: new LocalNavigationPolicy() });
    assert.equal(result.status, "FAIL");
    assert.deepEqual(result.findings.map(value => value.severity), ["medium", "low"]);
    assert.deepEqual(await readdir(artifacts), ["root-800x600.png"]);
    assert.equal(closed, 1);
  });

  it("reports unavailable optional tooling without installing it", async () => {
    const provider = new PlaywrightVisualQAProvider(async () => undefined);
    await assert.rejects(() => provider.evaluate({ base_url: "http://localhost", design_spec: { version: 1, name: "x", summary: "x", routes: [] }, viewports: [], artifact_dir: ".", navigation_policy: new LocalNavigationPolicy() }), /no installation was attempted/);
  });

  it("rejects resolved off-allowlist routes before launching navigation", async () => {
    let pages = 0;
    const provider = new PlaywrightVisualQAProvider(async () => ({ chromium: { launch: async () => ({ newPage: async () => { pages++; throw new Error("unreachable"); }, close: async () => {} }) } }));
    await assert.rejects(() => provider.evaluate({ base_url: "http://localhost", design_spec: { version: 1, name: "x", summary: "x", routes: [{ path: "//evil.example/a", description: "x", acceptance_criteria: ["x"] }] }, viewports: [{ width: 1, height: 1 }], artifact_dir: ".", navigation_policy: new LocalNavigationPolicy() }), /not allowed/);
    assert.equal(pages, 0);
  });

  it("blocks off-allowlist subresources and rejects redirect destinations", async () => {
    let intercepted!: (route: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => Promise<void>;
    let aborted = 0;
    const provider = new PlaywrightVisualQAProvider(async () => ({ chromium: { launch: async () => ({
      newPage: async () => ({ route: async (_pattern, handler) => { intercepted = handler; }, setViewportSize: async () => {}, goto: async () => { await intercepted({ request: () => ({ url: () => "http://169.254.169.254/latest/meta-data" }), continue: async () => {}, abort: async () => { aborted++; } }); return { status: () => 302, url: () => "https://evil.example/redirect" }; }, title: async () => "x", locator: () => ({ isVisible: async () => true }), evaluate: async () => ({ width: 1, client: 1, text: 1 }), screenshot: async () => {} }),
      close: async () => {},
    }) } }));
    const result = await provider.evaluate({ base_url: "http://localhost", design_spec: { version: 1, name: "x", summary: "x", routes: [{ path: "/", description: "x", acceptance_criteria: ["x"] }] }, viewports: [{ width: 1, height: 1 }], artifact_dir: ".", navigation_policy: new LocalNavigationPolicy() });
    assert.equal(aborted, 1);
    assert.equal(result.findings[0]?.severity, "critical");
  });
});
