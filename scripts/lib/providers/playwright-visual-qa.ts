import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { VisualQAProviderUnavailableError, type VisualQAFinding, type VisualQAProvider, type VisualQAProviderInput, type VisualQAResult } from "../visual-qa.js";

type Page = {
  route(url: string, handler: (route: { request(): { url(): string }; continue(): Promise<void>; abort(reason?: string): Promise<void> }) => Promise<void>): Promise<void>;
  setViewportSize(value: { width: number; height: number }): Promise<void>;
  goto(url: string, options: { waitUntil: "networkidle"; timeout: number }): Promise<{ status(): number; url(): string } | null>;
  title(): Promise<string>;
  locator(selector: string): { isVisible(): Promise<boolean> };
  evaluate(fn: () => unknown): Promise<{ width: number; client: number; text: number }>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<void>;
};
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
type Playwright = { chromium: { launch(options: { headless: boolean }): Promise<Browser> } };
export type PlaywrightLoader = () => Promise<Playwright | undefined>;

async function loadPlaywright(): Promise<Playwright | undefined> {
  try {
    // The non-literal specifier keeps Playwright optional at build/package time.
    return await import("playwright" as string) as unknown as Playwright;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" || (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return undefined;
    throw error;
  }
}

/** Optional real-browser adapter. Consumers opt in with provider: playwright. */
export class PlaywrightVisualQAProvider implements VisualQAProvider {
  readonly name = "playwright";
  constructor(private readonly loader: PlaywrightLoader = loadPlaywright) {}

  async evaluate(input: VisualQAProviderInput): Promise<VisualQAResult> {
    const playwright = await this.loader();
    if (!playwright) throw new VisualQAProviderUnavailableError("Optional Visual QA provider requires the 'playwright' package; no installation was attempted.");
    const browser = await playwright.chromium.launch({ headless: true });
    const findings: VisualQAFinding[] = [];
    try {
      await mkdir(input.artifact_dir, { recursive: true });
      for (const route of input.design_spec.routes) for (const viewport of input.viewports) {
        const target = input.navigation_policy.assertAllowed(new URL(route.path, input.base_url).href).href;
        const page = await browser.newPage();
        const label = `${safeName(route.path)}-${viewport.width}x${viewport.height}.png`;
        const screenshot = resolve(input.artifact_dir, label);
        try {
          await page.route("**/*", async intercepted => {
            try {
              input.navigation_policy.assertAllowed(intercepted.request().url());
              await intercepted.continue();
            } catch {
              await intercepted.abort("blockedbyclient");
            }
          });
          await page.setViewportSize(viewport);
          const response = await page.goto(target, { waitUntil: "networkidle", timeout: 30_000 });
          if (response) input.navigation_policy.assertAllowed(response.url());
          if (!response || response.status() >= 400) findings.push({ severity: "high", message: `Route returned HTTP ${response?.status() ?? "unknown"}.`, route: route.path, viewport, evidence: screenshot });
          const visible = await page.locator("body").isVisible();
          const metrics = await page.evaluate(() => {
            const doc = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number }; body?: { innerText: string } } }).document;
            return { width: doc.documentElement.scrollWidth, client: doc.documentElement.clientWidth, text: doc.body?.innerText.trim().length ?? 0 };
          });
          if (!visible || metrics.text === 0) findings.push({ severity: "high", message: "Rendered body has no visible text.", route: route.path, viewport, evidence: screenshot });
          if (metrics.width > metrics.client + 1) findings.push({ severity: "medium", message: `Horizontal overflow detected (${metrics.width}px > ${metrics.client}px).`, route: route.path, viewport, evidence: screenshot });
          if (!(await page.title()).trim()) findings.push({ severity: "low", message: "Document title is empty.", route: route.path, viewport, evidence: screenshot });
          await page.screenshot({ path: screenshot, fullPage: true });
        } catch (error) {
          findings.push({ severity: "critical", message: `Rendered inspection failed: ${error instanceof Error ? error.message : String(error)}`, route: route.path, viewport, evidence: screenshot });
        }
      }
    } finally { await browser.close(); }
    return { status: findings.length ? "FAIL" : "PASS", outcome_code: findings.length ? "findings" : "passed", summary: findings.length ? `${findings.length} deterministic rendered finding(s).` : "All routes rendered visibly without deterministic findings.", findings, startup_gate: { status: "PASS", summary: "Development server was ready." }, residual_findings: findings.length };
  }
}

function safeName(route: string): string {
  return route.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9.-]+/gi, "-") || "root";
}
