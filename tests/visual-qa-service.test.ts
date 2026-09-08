import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DevelopmentServerManager,
  LocalNavigationPolicy,
  VisualQAProviderRegistry,
  VisualQAService,
  VisualQAProviderUnavailableError,
  parseStartCommand,
  redactDiagnostic,
  type ManagedProcess,
  type VisualQAProvider,
} from "../scripts/lib/visual-qa.js";

const spec = { version: 1 as const, name: "App", summary: "test", routes: [] };
const viewport = [{ width: 800, height: 600 }];

describe("Visual QA provider registry and service", () => {
  it("handles disabled and unavailable providers without starting a server", async () => {
    const registry = new VisualQAProviderRegistry();
    let starts = 0;
    const servers = { start: async () => { starts++; throw new Error("unexpected"); } };
    const service = new VisualQAService(registry, servers);
    const base = { server: { cwd: ".", readyUrl: "http://localhost:3000", startupTimeoutMs: 10, shutdownTimeoutMs: 10 }, designSpec: spec, viewports: viewport };
    assert.equal((await service.evaluate({ ...base, enabled: false })).status, "BLOCKED");
    assert.equal((await service.evaluate({ ...base, enabled: false })).outcome_code, "disabled");
    const unavailable = await service.evaluate({ ...base, enabled: true, provider: "missing" });
    assert.equal(unavailable.status, "BLOCKED");
    assert.equal(unavailable.outcome_code, "provider_unavailable");
    assert.equal(starts, 0);
  });

  it("registers providers, rejects duplicates, and preserves findings", async () => {
    const provider: VisualQAProvider = { name: "fake", evaluate: async () => ({
      status: "FAIL", summary: "one issue", findings: [{ severity: "high", message: "Overlap" }],
      startup_gate: { status: "PASS", summary: "ready" }, residual_findings: 1,
    }) };
    const registry = new VisualQAProviderRegistry();
    registry.register(provider);
    assert.deepEqual(registry.names(), ["fake"]);
    assert.throws(() => registry.register(provider), /already registered/);
    let stopped = 0;
    const servers = { start: async () => ({ url: new URL("http://localhost:1/"), owned: true, stop: async () => { stopped++; } }) };
    const result = await new VisualQAService(registry, servers).evaluate({ enabled: true, provider: "fake", server: { cwd: ".", readyUrl: "http://localhost:1", startupTimeoutMs: 1, shutdownTimeoutMs: 1 }, designSpec: spec, viewports: viewport });
    assert.equal(result.status, "FAIL");
    assert.equal(result.findings[0]?.message, "Overlap");
    assert.equal(stopped, 1);
  });

  it("returns redacted startup failures", async () => {
    const registry = new VisualQAProviderRegistry();
    registry.register({ name: "fake", evaluate: async () => { throw new Error("unused"); } });
    const servers = { start: async () => { throw new Error("failed?token=top-secret&x=1"); } };
    const result = await new VisualQAService(registry, servers).evaluate({ enabled: true, provider: "fake", server: { cwd: ".", readyUrl: "http://localhost", startupTimeoutMs: 1, shutdownTimeoutMs: 1 }, designSpec: spec, viewports: viewport });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.startup_gate.status, "FAIL");
    assert.equal(result.outcome_code, "startup_failed");
    assert.doesNotMatch(result.summary, /top-secret/);
  });

  it("distinguishes uninstalled providers from provider runtime failures", async () => {
    const registry = new VisualQAProviderRegistry();
    let unavailable = true;
    registry.register({ name: "fake", evaluate: async () => { if (unavailable) throw new VisualQAProviderUnavailableError("not installed"); throw new Error("crashed"); } });
    const servers = { start: async () => ({ url: new URL("http://localhost/"), owned: false, stop: async () => {} }) };
    const base = { enabled: true, provider: "fake", server: { cwd: ".", readyUrl: "http://localhost", startupTimeoutMs: 1, shutdownTimeoutMs: 1 }, designSpec: spec, viewports: viewport };
    assert.equal((await new VisualQAService(registry, servers).evaluate(base)).outcome_code, "provider_unavailable");
    unavailable = false;
    assert.equal((await new VisualQAService(registry, servers).evaluate(base)).outcome_code, "provider_failed");
  });

  it("enforces configured route include and exclude patterns", async () => {
    let paths: string[] = [];
    const registry = new VisualQAProviderRegistry();
    registry.register({ name: "fake", evaluate: async input => { paths = input.design_spec.routes.map(route => route.path); return { status: "PASS", summary: "ok", findings: [], startup_gate: { status: "PASS", summary: "ready" }, residual_findings: 0 }; } });
    const servers = { start: async () => ({ url: new URL("http://localhost/"), owned: false, stop: async () => {} }) };
    const designSpec = { ...spec, routes: ["/admin", "/app/home", "/app/private"].map(path => ({ path, description: path, acceptance_criteria: ["ok"] })) };
    await new VisualQAService(registry, servers).evaluate({ enabled: true, provider: "fake", routes: { include: ["/app/**"], exclude: ["/app/private"] }, server: { cwd: ".", readyUrl: "http://localhost", startupTimeoutMs: 1, shutdownTimeoutMs: 1 }, designSpec, viewports: viewport });
    assert.deepEqual(paths, ["/app/home"]);
  });
});

describe("local navigation and commands", () => {
  it("allows loopback and explicitly allowed exact hosts only", () => {
    const policy = new LocalNavigationPolicy(["dev.internal"]);
    assert.equal(policy.assertAllowed("http://localhost:3000/a").hostname, "localhost");
    assert.equal(policy.assertAllowed("https://dev.internal/path").hostname, "dev.internal");
    assert.throws(() => policy.assertAllowed("https://evil.example"), /not allowed/);
    assert.throws(() => policy.assertAllowed("http://user:pass@localhost"), /credential-free/);
    assert.throws(() => policy.assertAllowed("file:///tmp/a"), /HTTP/);
  });

  it("parses explicit argv without a shell and rejects shell expressions", () => {
    assert.deepEqual(parseStartCommand('npm run dev -- --name "visual qa"'), ["npm", "run", "dev", "--", "--name", "visual qa"]);
    assert.throws(() => parseStartCommand("npm run dev && calc"), /shell syntax/);
    assert.throws(() => parseStartCommand("npm 'run dev"), /unterminated/);
  });

  it("redacts common credentials", () => {
    const value = redactDiagnostic(new Error("Bearer abc token=secret api_key:another"));
    assert.doesNotMatch(value, /abc|secret|another/);
  });
});

describe("managed development server", () => {
  it("does not own or stop an already-ready server", async () => {
    let launches = 0;
    const manager = new DevelopmentServerManager(() => { launches++; throw new Error(); }, async () => true);
    const session = await manager.start({ cwd: ".", readyUrl: "http://localhost:1", startCommand: "npm run dev", startupTimeoutMs: 10, shutdownTimeoutMs: 10, navigationPolicy: new LocalNavigationPolicy() });
    assert.equal(session.owned, false);
    await session.stop();
    assert.equal(launches, 0);
  });

  it("stops only its launched process after readiness", async () => {
    let terminated = 0;
    let resolveExit!: (value: { code: number | null }) => void;
    const process: ManagedProcess = { exited: new Promise(resolve => { resolveExit = resolve; }), terminate: () => { terminated++; resolveExit({ code: 0 }); }, kill: () => {} };
    let probes = 0;
    const manager = new DevelopmentServerManager(() => process, async () => ++probes > 1);
    const session = await manager.start({ cwd: ".", readyUrl: "http://127.0.0.1:1", startCommand: "npm run dev", startupTimeoutMs: 1000, shutdownTimeoutMs: 20, navigationPolicy: new LocalNavigationPolicy() });
    assert.equal(session.owned, true);
    await session.stop();
    await session.stop();
    assert.equal(terminated, 1);
  });

  it("times out and cleans up a process it started", async () => {
    let now = 0, terminated = 0;
    let resolveExit!: (value: { code: number | null }) => void;
    const process: ManagedProcess = { exited: new Promise(resolve => { resolveExit = resolve; }), terminate: () => { terminated++; resolveExit({ code: 0 }); }, kill: () => {} };
    const manager = new DevelopmentServerManager(() => process, async () => false, () => now, async ms => { now += Math.max(ms, 1); });
    await assert.rejects(() => manager.start({ cwd: ".", readyUrl: "http://localhost:1", startCommand: "npm run dev", startupTimeoutMs: 3, shutdownTimeoutMs: 3, navigationPolicy: new LocalNavigationPolicy() }), /timed out/);
    assert.equal(terminated, 1);
  });
});
