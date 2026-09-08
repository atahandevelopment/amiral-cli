import type { UiViewport } from "./team-config.js";
import spawn from "cross-spawn";
import { resolve } from "node:path";

export type DesignSpec = {
  version: 1;
  name: string;
  summary: string;
  routes: DesignSpecRoute[];
};

export type DesignSpecRoute = {
  path: string;
  description: string;
  acceptance_criteria: string[];
};

export type VisualQAFinding = {
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  route?: string;
  viewport?: UiViewport;
  evidence?: string;
};

export type VisualQAResult = {
  status: "PASS" | "FAIL" | "BLOCKED";
  summary: string;
  findings: VisualQAFinding[];
  /** Explicit startup gate: visual evaluation cannot pass unless the app was ready. */
  startup_gate: VisualQAStartupGate;
  /** Findings still open after this iteration; PASS requires zero. */
  residual_findings: number;
  /** Machine-readable orchestration semantics. Optional for legacy artifacts/providers. */
  outcome_code?: VisualQAOutcomeCode;
};

export type VisualQAOutcomeCode = "passed" | "findings" | "disabled" | "provider_unavailable" | "artifact_unavailable" | "startup_failed" | "provider_failed";

export class VisualQAProviderUnavailableError extends Error {}

export type VisualQAStartupGate = {
  status: "PASS" | "FAIL" | "BLOCKED";
  summary: string;
};

export type VisualQAProviderInput = {
  base_url: string;
  design_spec: DesignSpec;
  viewports: UiViewport[];
  artifact_dir: string;
  navigation_policy: LocalNavigationPolicy;
};

/** Provider-neutral boundary; implementations own browser and image tooling. */
export interface VisualQAProvider {
  readonly name: string;
  evaluate(input: VisualQAProviderInput): Promise<VisualQAResult>;
}

/** Small registry kept in core so browser-backed providers can live in adapters. */
export class VisualQAProviderRegistry {
  readonly #providers = new Map<string, VisualQAProvider>();

  register(provider: VisualQAProvider): void {
    const name = provider.name.trim();
    if (!name) throw new Error("Visual QA provider name must not be empty.");
    if (this.#providers.has(name)) throw new Error(`Visual QA provider "${name}" is already registered.`);
    this.#providers.set(name, provider);
  }

  get(name: string): VisualQAProvider | undefined { return this.#providers.get(name.trim()); }
  has(name: string): boolean { return this.get(name) !== undefined; }
  names(): string[] { return [...this.#providers.keys()].sort(); }
}

/** Process-wide registry populated by the application composition root. */
export const visualQAProviders = new VisualQAProviderRegistry();

export function registerVisualQAProvider(provider: VisualQAProvider): void {
  visualQAProviders.register(provider);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Exact-host navigation allowlist. Protocol-relative URLs, credentials and non-HTTP schemes are denied. */
export class LocalNavigationPolicy {
  readonly #hosts: Set<string>;

  constructor(allowedHosts: readonly string[] = []) {
    this.#hosts = new Set(LOCAL_HOSTS);
    for (const value of allowedHosts) {
      const host = normalizeAllowedHost(value);
      this.#hosts.add(host);
    }
  }

  assertAllowed(value: string): URL {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Visual QA navigation URL is invalid."); }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new Error("Visual QA navigation permits only credential-free HTTP(S) URLs.");
    }
    if (!this.#hosts.has(url.hostname.toLowerCase())) {
      throw new Error(`Visual QA navigation host "${url.hostname}" is not allowed.`);
    }
    return url;
  }
}

function normalizeAllowedHost(value: string): string {
  const candidate = value.trim().toLowerCase();
  if (!candidate || candidate.includes("/") || candidate.includes("@") || candidate.includes(":")) {
    // Bracketed IPv6 loopback is the sole colon-bearing hostname accepted here.
    if (candidate !== "[::1]" && candidate !== "::1") {
      throw new Error(`Invalid Visual QA allowed host "${value}".`);
    }
  }
  if (!/^[a-z0-9.-]+$/.test(candidate) && candidate !== "[::1]" && candidate !== "::1") {
    throw new Error(`Invalid Visual QA allowed host "${value}".`);
  }
  return candidate;
}

export type ManagedProcess = {
  readonly exited: Promise<{ code: number | null; signal?: string }>;
  terminate(): void;
  kill(): void;
};

export type ProcessLauncher = (command: string, args: readonly string[], cwd: string) => ManagedProcess;
export type ReadinessProbe = (url: URL, signal: AbortSignal) => Promise<boolean>;

export type DevelopmentServerOptions = {
  cwd: string;
  readyUrl: string;
  startCommand?: string;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
  navigationPolicy: LocalNavigationPolicy;
};

export type DevelopmentServerSession = { url: URL; owned: boolean; stop(): Promise<void> };
export interface DevelopmentServerController { start(options: DevelopmentServerOptions): Promise<DevelopmentServerSession> }

/** Owns only processes it launches. An already-running server is never terminated. */
export class DevelopmentServerManager {
  constructor(
    private readonly launch: ProcessLauncher = defaultProcessLauncher,
    private readonly probe: ReadinessProbe = defaultReadinessProbe,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  ) {}

  async start(options: DevelopmentServerOptions): Promise<DevelopmentServerSession> {
    const url = options.navigationPolicy.assertAllowed(options.readyUrl);
    if (await this.safeProbe(url, Math.min(1_000, options.startupTimeoutMs))) return { url, owned: false, stop: async () => {} };

    let process: ManagedProcess | undefined;
    if (options.startCommand) {
      const [command, ...args] = parseStartCommand(options.startCommand);
      process = this.launch(command!, args, options.cwd);
    }
    const deadline = this.now() + options.startupTimeoutMs;
    try {
      while (this.now() < deadline) {
        if (process) {
          const exit = await Promise.race([process.exited, this.sleep(0).then(() => undefined)]);
          if (exit) throw new Error(`Development server exited before readiness (code ${exit.code ?? "unknown"}).`);
        }
        if (await this.safeProbe(url, Math.min(1_000, Math.max(1, deadline - this.now())))) return this.session(url, process, options.shutdownTimeoutMs);
        await this.sleep(Math.min(100, Math.max(1, deadline - this.now())));
      }
      throw new Error("Development server readiness timed out.");
    } catch (error) {
      if (process) await stopOwnedProcess(process, options.shutdownTimeoutMs);
      throw error;
    }
  }

  private async safeProbe(url: URL, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.probe(url, controller.signal),
        new Promise<false>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, timeoutMs); }),
      ]);
    } catch { return false; } finally { if (timer) clearTimeout(timer); }
  }

  private session(url: URL, process: ManagedProcess | undefined, timeout: number): DevelopmentServerSession {
    let stopped = false;
    return { url, owned: !!process, stop: async () => {
      if (!process || stopped) return;
      stopped = true;
      await stopOwnedProcess(process, timeout);
    } };
  }
}

export function parseStartCommand(value: string): [string, ...string[]] {
  if (!value.trim()) throw new Error("Development server start command must not be empty.");
  // No shell is involved. Reject shell syntax rather than pretending to interpret it safely.
  if (/[;&|<>`\r\n$]/.test(value)) throw new Error("Development server start command contains unsupported shell syntax.");
  const parts: string[] = [];
  let token = "", quote: "'" | '"' | undefined;
  for (const char of value.trim()) {
    if (quote) { if (char === quote) quote = undefined; else token += char; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (/\s/.test(char)) { if (token) { parts.push(token); token = ""; } } else token += char;
  }
  if (quote) throw new Error("Development server start command has an unterminated quote.");
  if (token) parts.push(token);
  if (!parts.length) throw new Error("Development server start command must not be empty.");
  return parts as [string, ...string[]];
}

export type VisualQAServiceOptions = {
  enabled: boolean;
  provider?: string;
  allowedHosts?: readonly string[];
  server: Omit<DevelopmentServerOptions, "navigationPolicy">;
  designSpec: DesignSpec;
  viewports: UiViewport[];
  routes?: { include: readonly string[]; exclude: readonly string[] };
};

export class VisualQAService {
  constructor(private readonly providers: VisualQAProviderRegistry, private readonly servers: DevelopmentServerController = new DevelopmentServerManager()) {}

  async evaluate(options: VisualQAServiceOptions): Promise<VisualQAResult> {
    if (!options.enabled) return blocked("Visual QA is disabled.", "disabled");
    const provider = options.provider && this.providers.get(options.provider);
    if (!provider) return blocked("The configured Visual QA provider is unavailable.", "provider_unavailable");
    let session: DevelopmentServerSession | undefined;
    try {
      session = await this.servers.start({ ...options.server, navigationPolicy: new LocalNavigationPolicy(options.allowedHosts) });
    } catch (error) {
      return { ...blocked(`Visual QA startup failed: ${redactDiagnostic(error)}`, "startup_failed"), startup_gate: { status: "FAIL", summary: "Development server failed to become ready." } };
    }
    try {
      const designSpec = { ...options.designSpec, routes: filterRoutes(options.designSpec.routes, options.routes) };
      const result = await provider.evaluate({ base_url: session.url.href, design_spec: designSpec, viewports: options.viewports, artifact_dir: resolve(options.server.cwd, ".amiral", "gates", "screenshots"), navigation_policy: new LocalNavigationPolicy(options.allowedHosts) });
      return normalizeProviderResult(result);
    } catch (error) {
      if (error instanceof VisualQAProviderUnavailableError) return { ...blocked(`Visual QA provider is unavailable: ${redactDiagnostic(error)}`, "provider_unavailable"), startup_gate: { status: "PASS", summary: "Development server was ready." } };
      return { ...blocked(`Visual QA provider failed: ${redactDiagnostic(error)}`, "provider_failed"), startup_gate: { status: "PASS", summary: "Development server was ready." } };
    } finally { await session?.stop(); }
  }
}

function filterRoutes(routes: DesignSpecRoute[], policy?: { include: readonly string[]; exclude: readonly string[] }): DesignSpecRoute[] {
  const matches = (path: string, patterns: readonly string[]): boolean => patterns.some(pattern => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
    return new RegExp(`^${escaped}$`).test(path);
  });
  return routes.filter(route => (!policy?.include.length || matches(route.path, policy.include)) && !matches(route.path, policy?.exclude ?? []));
}

function blocked(summary: string, outcome_code: VisualQAOutcomeCode): VisualQAResult {
  return { status: "BLOCKED", outcome_code, summary, findings: [], startup_gate: { status: "BLOCKED", summary }, residual_findings: 0 };
}

function normalizeProviderResult(result: VisualQAResult): VisualQAResult {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const residual = findings.length;
  const status = residual === 0 && result.status === "PASS" ? "PASS" : "FAIL";
  return { ...result, status, outcome_code: result.outcome_code ?? (status === "PASS" ? "passed" : "findings"), findings, residual_findings: residual, startup_gate: { status: "PASS", summary: "Development server was ready." } };
}

export function redactDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/([?&](?:token|key|secret|password|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:bearer|basic)\s+[^\s]+/gi, "[REDACTED]")
    .replace(/\b(?:token|api[_-]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

const defaultReadinessProbe: ReadinessProbe = async (url, signal) => {
  const response = await fetch(url, { signal, redirect: "manual" });
  return response.status >= 200 && response.status < 500;
};

const defaultProcessLauncher: ProcessLauncher = (command, args, cwd) => {
  const child = spawn(command, [...args], { cwd, shell: false, stdio: "ignore" });
  const exited = new Promise<{ code: number | null; signal?: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, ...(signal ? { signal } : {}) }));
  });
  return { exited, terminate: () => child.kill(), kill: () => child.kill("SIGKILL") };
};

async function stopOwnedProcess(process: ManagedProcess, timeoutMs: number): Promise<void> {
  process.terminate();
  const exited = await Promise.race([process.exited.then(() => true, () => true), new Promise<false>(resolve => setTimeout(() => resolve(false), timeoutMs))]);
  if (!exited) process.kill();
}
