# Phase 13 — Resilience & Provider Abstraction

Phase 13 makes Amiral robust against transient AI-provider failures and
decouples execution from OpenCode-specific assumptions. OpenCode is now one
implementation behind a provider-neutral interface; scheduler, dispatcher,
workflow, task graph, review, and QA logic are provider-agnostic.

---

## Architecture

```
high-level goal
      ↓
Planner ──────────────┐
      ↓               │ prompt transport (getPromptTransport)
validated task DAG    │
      ↓               │
workflow state        │
      ↓               │
scheduler (run-workflow.ts)          ← retry_not_before awareness
      ↓
capability routing
      ↓
provider capacity  ← provider.getCapacity(teamConfig)
      ↓
execution request (+ provider name)
      ↓
dispatcher (dispatch-workflow.ts)    ← catches ProviderError
      ↓
provider registry → ExecutionProvider   ★ OpenCode is one implementation
      ↓
agent result (validated contract)
      ↓
task finalization / commit → integration → review → QA
                                      (quality gates via prompt transport)
```

### New modules

| Module | Responsibility |
| --- | --- |
| `scripts/lib/providers/provider.ts` | `ExecutionProvider`, `PromptTransportProvider`, execution input/output types |
| `scripts/lib/providers/provider-error.ts` | `ProviderError`, `ProviderErrorKind`, reusable failure classifier |
| `scripts/lib/providers/retry-policy.ts` | Pure `calculateRetryDelay` + budget helpers |
| `scripts/lib/providers/provider-registry.ts` | `registerProvider` / `getExecutionProvider` / `getPromptTransport` |
| `scripts/lib/providers/opencode-provider.ts` | OpenCode implementation (process spawn, prompts, result recovery, error classification) |
| `scripts/lib/providers/output-extraction.ts` | Provider-neutral text/JSON extraction (`extractTextEvents`, `extractJsonObject`) |
| `scripts/lib/agent-result.ts` | Canonical, provider-neutral `AgentResult` contract |
| `scripts/lib/provider-retry.ts` | Domain glue: persisted retry/failure state transitions + history events |
| `scripts/lib/scheduler-retry.ts` | Due/waiting retry discovery + promotion back to pending |

### Modified modules

- `types.ts` — `retry_wait` status, `retry_not_before`, `last_provider_error`,
  new history events.
- `team-config.ts` — normalized provider configuration with legacy fallbacks.
- `opencode-adapter.ts` — now a backward-compatibility shim delegating to the
  registry (historical imports keep working).
- `provider-capacity.ts` — thin wrapper over `provider.getCapacity`.
- `run-workflow.ts` — retry-aware scheduling, dynamic provider labels.
- `dispatch-workflow.ts` / `execute-request.ts` — structured `ProviderError`
  handling, defensive capacity enforcement.
- `run-quality-gate.ts`, `plan-workflow.ts` — execution through prompt
  transport instead of direct OpenCode spawning.
- `workflow-store.ts` — `deriveWorkflowStatus` understands `retry_wait`.
- Schemas: `workflow-state.schema.json` (new status/fields),
  `execution-request.schema.json` (optional `provider`).
- `team.yaml` — migrated to the canonical provider configuration shape.

---

## Provider Interface

```ts
interface ExecutionProvider {
  name: string;
  execute(input: {
    request: ExecutionRequest;
    cwd: string;
    teamConfig: TeamConfig;
  }): Promise<{
    result?: AgentResult;
    raw_stdout?: string;
    raw_stderr?: string;
    metadata?: Record<string, unknown>;
  }>;
  getCapacity(teamConfig: TeamConfig): ProviderCapacity;
}
```

Planner and quality gates do not use the ExecutionRequest contract, so
providers may additionally implement a prompt transport:

```ts
interface PromptTransportProvider {
  runPrompt(input: {
    agent: string;
    prompt: string;
    cwd: string;
    teamConfig: TeamConfig;
    model?: string;
    autoApprove?: boolean;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}
```

`runPrompt` never throws for non-zero exits; callers classify the outcome
with `classifyProviderFailure`. Only spawn-level failures (missing binary)
throw a `ProviderError` (`configuration`, non-retryable).

**Contract separation:** the provider transports execution; the domain layer
validates its own result contracts (`TaskGraphPlan`, `AgentResult`,
`QualityGateResult`). They are never merged into one schema.

---

## Provider Registry

```ts
import { getExecutionProvider, getPromptTransport } from "./lib/providers/provider-registry.js";

const provider = getExecutionProvider("opencode"); // throws for unknown names:
// Provider "foo" is not registered. Registered providers: opencode.

const transport = getPromptTransport("opencode"); // requires runPrompt capability
```

OpenCode self-registers on module load. A future provider registers itself
the same way without touching orchestration code.

---

## Error Model & Classification Policy

```ts
type ProviderErrorKind =
  | "rate_limit" | "unavailable" | "timeout" | "network"
  | "authentication" | "configuration" | "protocol"
  | "capacity" | "unknown";

class ProviderError extends Error {
  provider: string;
  kind: ProviderErrorKind;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  raw?: unknown;
}
```

Classification precedence:

1. **Structured status codes** (when a provider exposes them) win over text.
2. **Text rules** against combined message/stderr/stdout (ordered, first match):
   - `429`, rate limit, quota cooldown → `rate_limit` (retryable)
   - `503`/`502`/`500`, service unavailable → `unavailable` (retryable)
   - database locked / sqlite busy → `capacity` (retryable)
   - ETIMEDOUT, request timed out → `timeout` (retryable)
   - ECONNRESET, EAI_AGAIN, ENOTFOUND, socket hang up, DNS → `network` (retryable)
   - `401`/`403`, invalid api key, unauthorized → `authentication` (**no retry**)
   - unsupported model, invalid config, ENOENT/command not found → `configuration` (**no retry**)
3. **Retry-After hints** in output are parsed into `retryAfterMs` regardless of kind.
4. **Unrecognized failures** → `unknown`, **non-retryable**, so unexpected
   errors surface instead of looping silently.

`protocol` failures (provider finished but ignored the result contract) are
**non-retryable by default policy**: Amiral still produces the structured
fallback failed AgentResult (Phase 11 behavior preserved), which flows through
the normal task-failure path. Result-contract mismatches (lease/task/workflow
id) remain plain runtime errors — they indicate staleness or bugs, never
transient transport problems, and are never silently retried.

Scheduler/dispatcher code branches only on `error.kind` / `error.retryable`;
it never inspects OpenCode strings.

---

## Retry Lifecycle (Chosen Model)

**Task attempt = one scheduler claim / lease lifecycle. Provider retries are
persisted, not in-process.**

```
provider transient failure (e.g. 503)
      ↓
dispatcher catches ProviderError (retryable=true)
      ↓
release lease (lease_id=null, started_at=null)
      ↓
task.status = "retry_wait"
task.retry_not_before = now + calculateRetryDelay(...)   ← persisted in state.json
task.last_provider_error = { provider, kind, message, retryable, status_code }
      ↓
history: provider_retry_scheduled + task_status_changed
      ↓
scheduler (any later process): retry_not_before <= now ?
      ├─ no  → listed under "Retry waiting:", not selected
      └─ yes → promoted to pending (history: task_retried)
                → capability routing → capacity check → claim (attempts += 1)
```

- **No blocking sleeps anywhere.** No `setTimeout` orchestration. Correctness
  relies purely on persisted timestamps compared to the wall clock, so
  process restarts are harmless.
- **Budget:** attempts advance only at claim time. When a transient failure
  occurs with `attempts >= max_attempts`, the task becomes **blocked**
  instead of retry_wait (history: `provider_failure`).
- **Recovery:** when a previously-failed task finally completes, the
  dispatcher records a `provider_recovered` history event and clears the
  stale diagnostic.

### Retry delay

```
delay(attempt) = min(baseDelayMs * 2^(attempt-1), maxDelayMs)
```

- `retryAfterMs` from the provider is preferred when positive, clamped into
  `[baseDelayMs, maxDelayMs]` so a broken hint can neither disable nor extend
  our own budget.
- Optional jitter multiplies by a factor in `[0.8, 1.2]` (±20%), re-clamped
  to `maxDelayMs`. Deterministic tests inject a random source.
- Defaults: base 2000 ms, max 30000 ms, jitter on, budget =
  `execution.max_attempts`.

---

## Scheduler Behavior (run-workflow.ts)

- Pending tasks eligible as before; reviewer/QA still excluded.
- Due `retry_wait` tasks are promoted to pending before selection (persisted
  in real runs, in-memory preview in `--dry-run`).
- Future `retry_not_before` tasks are ignored for selection but displayed:

```
Retry waiting:
  - AUTO-002 [frontend]
    provider: opencode
    reason: unavailable
    retry at: 2026-08-21T17:10:00.000Z
    attempt: 2/3
```

- Capability routing still applies after retry promotion.
- Effective parallelism remains `min(execution.max_parallel_agents,
  provider.maxConcurrency)`; the provider name comes from configuration
  (`execution.default_provider`, default `opencode`).

## Dispatcher Behavior

- Obtains the provider through the registry; enforces
  `min(max_parallel_agents, provider.maxConcurrency)` defensively regardless
  of what the scheduler computed.
- Catches `ProviderError`:
  - retryable + budget → `retry_wait` with structured console diagnostics
    (`⚠ TASK agent provider failure (unavailable, status 503) ... retry at ...`)
  - retryable + exhausted → `blocked`
  - non-retryable → `failed` immediately
- Non-provider errors keep the existing generic `error` path.

## Worktree Retry Safety

On any provider failure the task worktree is **never removed or recreated**.
`createTaskWorktree` already reuses an existing worktree path, so a retry
runs on the same task branch with partial changes intact; the dispatcher logs
`worktree preserved for retry: <path>`. The agent can inspect what was already
done on its next attempt; nothing is silently discarded. Cleanup remains the
exclusive job of `worktree-clean.ts` policies.

---

## Configuration

Canonical (used by this repo's `team.yaml`):

```yaml
execution:
  default_provider: opencode     # NEW (optional)
  max_parallel_agents: 1
  lease_minutes: 30
  max_attempts: 3

providers:
  opencode:
    enabled: true                # NEW (optional, default true)
    max_concurrency: 1
    binary: opencode             # NEW location (optional)
    auto_approve: false          # NEW location (optional)
    retry:                       # NEW (all optional)
      max_attempts: 3            # default: execution.max_attempts
      base_delay_ms: 2000
      max_delay_ms: 30000
      jitter: true
```

Legacy configs keep working unchanged. Normalization rules
(`resolveProviderConfig`):

- `binary` / `auto_approve`: `providers.<name>.*` → legacy root `<name>.*` → defaults
- `enabled`: default true; `max_concurrency`: default 1 (old behavior)
- retry: `max_attempts` falls back to `execution.max_attempts`; delays/jitter
  fall back to built-in defaults

Verified against a legacy fixture: root `opencode.binary: oc.exe`,
`auto_approve: true`, `providers.opencode.max_concurrency: 2`,
`execution.max_attempts: 4` all normalize correctly.

---

## State / Schema Changes

`RuntimeTask` additions (all optional → old states load unchanged):

```jsonc
{
  "status": "retry_wait",           // new enum value
  "retry_not_before": "2026-08-21T17:10:00.000Z",
  "last_provider_error": {
    "provider": "opencode",
    "kind": "unavailable",
    "message": "...",
    "retryable": true,
    "status_code": 503
  }
}
```

`deriveWorkflowStatus`: `retry_wait` counts as activity (workflow stays
`running`) and does not trigger `blocked`; only blocked-with-nothing-active
does.

New history events (with optional structured `details` payload for Phase 15
observability):

- `provider_retry_scheduled` — provider, kind, attempt, next_retry_at, delay_ms
- `provider_failure` — provider, kind, retryable, attempt
- `provider_recovered` — recorded when a retried task completes

`ExecutionRequest.provider?: string` records which provider the scheduler
selected (optional; old request files stay valid).

---

## Planner / Review / QA Integration

All three now execute through `getPromptTransport(defaultProvider)`:

- **Planner** (`plan-workflow.ts`): same prompt, same JSON extraction and
  validation pipeline; nonzero exits produce classified provider errors.
- **Review gate**: behavior unchanged — PASS / CHANGES_REQUESTED / BLOCKED,
  same normalization and schema validation.
- **QA gate**: behavior unchanged — PASS / FAIL / BLOCKED; workflow completion
  logic untouched.

Gates are still quality gates outside normal task scheduling; they are not
merged into the DAG.

---

## Backward Compatibility

- All existing commands keep their interfaces and outputs (plus the new
  retry sections/labels).
- Existing `team.yaml` files work without modification (legacy normalization).
- Persisted workflow states without retry fields load fine; old execution
  requests validate (provider field optional); old task graphs remain valid.
- `opencode-adapter.ts` still exports `executeWithOpenCode`,
  `extractTextEvents`, `extractJsonObject`, and the `AgentResult` type for
  any external consumers — now implemented via the registry.
- Agent Result recovery chain preserved: result file → stdout JSON recovery →
  structured protocol-failure result.

---

## CLI Examples

```bash
# Schedule (shows retry waiting section when applicable)
npx tsx scripts/run-workflow.ts --dry-run
npx tsx scripts/run-workflow.ts

# Status shows retry diagnostics
npx tsx scripts/workflow-state.ts status
# DB-001         retry_wait   database
#   provider: opencode
#   reason: unavailable
#   retry: 2026-08-21T16:15:43.289Z
#   attempt: 1/3

# Dispatch (structured provider failure handling)
npx tsx scripts/dispatch-workflow.ts

# Quality gates through the abstraction
npx tsx scripts/run-quality-gate.ts review
npx tsx scripts/run-quality-gate.ts qa

# Planner through the abstraction
npx tsx scripts/plan-workflow.ts feature "Add JWT authentication"
```

---

## How to Add a CodexProvider Later (Guide)

1. Create `scripts/lib/providers/codex-provider.ts` implementing
   `ExecutionProvider` (and `PromptTransportProvider` if planner/gates should
   use it):

   ```ts
   export class CodexProvider implements ExecutionProvider {
     readonly name = "codex";

     getCapacity(teamConfig: TeamConfig): ProviderCapacity {
       return {
         provider: this.name,
         maxConcurrency: resolveProviderConfig(teamConfig, this.name).max_concurrency,
       };
     }

     async execute({ request, cwd, teamConfig }: ProviderExecutionInput) {
       // 1. Build a Codex-specific prompt from `request`.
       // 2. Spawn/HTTP-call Codex.
       // 3. On transport failure throw classifyProviderFailure({...}) —
       //    never return generic Errors for expected provider failures.
       // 4. Recover/normalize output into an AgentResult and validate it
       //    with validateContract("agent-result", result).
       // 5. Return { result, raw_stdout, metadata }.
     }
   }
   ```

2. Register it in `provider-registry.ts`: `registerProvider(new CodexProvider());`
3. Add a `providers.codex:` section (and optionally
   `execution.default_provider: codex`) to `team.yaml`.
4. Nothing else changes: workflow-state, task graph, scheduler semantics,
   retry model, review loop, QA loop, and worktree lifecycle are
   provider-agnostic already.

---

## Known Limitations

- Only the OpenCode provider is implemented (per scope); multi-provider
  selection/load balancing is future work.
- No process-level execution timeout yet: timeout detection relies on
  provider output patterns (ETIMEDOUT etc.), not a hard kill timer.
- Quality gates and the planner surface classified provider errors but do
  not auto-retry; automatic gate retry belongs to a later phase.
- Conflict-domain serialization (Phase 12 helpers) is still advisory only.
- Deliberately out of scope: web UI/dashboard, Telegram, auto-PR, token/cost
  analytics, remote control, plugins/billing, distributed workers,
  speculative duplicate execution, Phase 15 observability UI.

---

## Test Coverage

`npm test` (node:test via tsx) — 74 tests across 12 suites, including:

- **provider-error.test.ts** — 429/503/timeout/network/database-lock/
  authentication/configuration/unknown classification, structured-status
  precedence, Retry-After extraction, protocol non-retryability
- **retry-policy.test.ts** — exponential growth, max cap, retry-after
  override + clamping, deterministic jitter bounds, budget exhaustion,
  config validation
- **provider-registry.test.ts** — opencode resolution, unknown-provider
  error, prompt-transport capability checks, capacity delegation
- **output-extraction.test.ts** — text-event joining, fenced/embedded/raw
  JSON recovery, null cases, protocol-failure fallback results
- **scheduler-retry.test.ts** — future vs expired retry timestamps, missing
  timestamp safety, non-retry-task exclusion, persisted promotion
- **provider-retry.test.ts** — retry_wait transition with lease release and
  history events, budget exhaustion → blocked, permanent failure → failed
  with persisted diagnostics, recovery recording, legacy state loading,
  save/load round-trips
