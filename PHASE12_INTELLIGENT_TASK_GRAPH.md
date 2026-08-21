# Phase 12 — Intelligent Task Graph

Phase 12 turns a high-level user request into a validated, dependency-aware,
capability-aware DAG that Amiral can execute safely through the existing
workflow runtime.

```
User goal ("Add JWT authentication with PostgreSQL and a Next.js login page")
      ↓
Planner agent (OpenCode, planner instructions + team.yaml capabilities)
      ↓
Task Graph Plan JSON  →  normalize  →  validate (schema + semantics + capabilities)
      ↓
plans/<plan-id>/task-graph.json   (canonical task graph)
      ↓
workflow-state.ts create-from-plan
      ↓
normal WorkflowState → run-workflow.ts / dispatch-workflow.ts / quality gates
```

Planning and workflow creation are intentionally separate steps.

---

## Purpose

- Let a Planner produce a **structured Task Graph Plan** instead of free-form text.
- Guarantee that generated graphs are **deterministic enough to validate,
  inspect, and execute** through the existing Amiral workflow.
- Make planning **capability-aware**: the Planner may only use agents and
  capabilities that actually exist in `team.yaml`.
- Detect **conflict domains** between independent tasks before execution.
- Preserve full **backward compatibility** with existing task graphs and all
  Phase 1–11 behavior (scheduler, leases, retry, worktrees, review/QA gates,
  capability routing, result contracts).

---

## Architecture

### New modules

| Module | Responsibility |
| --- | --- |
| `scripts/lib/task-graph-planner.ts` | Plan contract types, safe normalization, plan validation (reuses existing semantic validators), planner prompt builder, plan → canonical graph conversion, plan/graph file loading |
| `scripts/lib/task-graph-analysis.ts` | Pure graph analysis: depth, edges, roots/leaves, parallel groups, conflict-domain warnings, quality findings, CLI formatting |
| `scripts/lib/workflow-create.ts` | Shared workflow creation extracted from `workflow-state.ts` (`createWorkflowFromGraph`, `toRuntimeTasks`) |
| `scripts/plan-workflow.ts` | CLI: runs the Planner agent via OpenCode (or consumes `--plan-file`), normalizes, validates, persists under `plans/<plan-id>/`, prints summary + analysis |

### Modified files

| File | Change |
| --- | --- |
| `scripts/lib/types.ts` | Added optional `routing` / `planning` metadata to `SourceTask`; added `CapabilityRouting`, `TaskPlanningMetadata` types; lease fields on `RuntimeTask` made optional to match real scheduler lifecycle |
| `scripts/lib/capability-scheduler.ts` | `CapabilityRouting` now imported from `types.ts` (re-exported for compatibility); new `getKnownCapabilities(config)` helper |
| `scripts/lib/workflow-create.ts` | (new, see above) |
| `scripts/workflow-state.ts` | Uses shared `createWorkflowFromGraph`; new `create-from-plan <plan-file>` command |
| `scripts/lib/opencode-adapter.ts` | `extractTextEvents` / `extractJsonObject` hoisted to module scope and exported (reused by the planner CLI) |
| `scripts/lib/git-worktree.ts` | `sanitizeSegment` exported (reused by the planner CLI) |
| `scripts/lib/contract-validator.ts` | Registered `planner-result` schema incl. `$ref` dependency support |
| `scripts/validate-team.ts` | New `planner-result` contract type (schema + semantics + capability validation) |
| `.opencode/schemas/task.schema.json` | Added `$id` and optional `planning` object |
| `.opencode/schemas/workflow-state.schema.json` | Runtime task items now accept optional `routing` / `planning` |
| `.opencode/schemas/planner-result.schema.json` | (new) Planner output contract; references `task.schema.json` via `$ref` |
| `package.json` | `typecheck` / `test` scripts; `typescript` dev dependency |
| `tsconfig.typecheck.json` | (new) strict type-checking project for `scripts/` and `tests/` |
| `.gitignore` | `plans/` (generated artifacts stay local, like `tasks/*/`) |

### Deliberate reuse (no duplication)

- Graph semantics (duplicate ids, unknown/self dependencies, cycles) are
  validated by the **existing** `validateTaskGraphSemantics` in
  `scripts/lib/task-graph.ts`. The planner validator calls it; no logic was
  copied.
- Workflow creation logic was **extracted once** into
  `scripts/lib/workflow-create.ts`; both `create` and `create-from-plan` use it.
- JSON extraction from provider output reuses the adapter's
  `extractTextEvents` / `extractJsonObject`.
- Plan id sanitization reuses `sanitizeSegment` from `git-worktree.ts`.

---

## Planner Contract

File: `.opencode/schemas/planner-result.schema.json`

```json
{
  "goal": "Add JWT authentication with PostgreSQL and a Next.js login page",
  "summary": "Short plan summary",
  "workflow_type": "feature",
  "tasks": [
    {
      "id": "AUTH-DB",
      "title": "Create authentication persistence model",
      "agent": "database",
      "description": "...",
      "dependencies": [],
      "acceptance_criteria": ["..."],
      "routing": {
        "mode": "auto",
        "required_capabilities": ["database/postgresql", "database/migrations"],
        "preferred_agents": ["database"]
      },
      "planning": {
        "priority": "high",
        "estimated_complexity": "medium",
        "risk": "medium",
        "expected_files": ["database/**"],
        "conflict_domains": ["database-schema"],
        "parallel_group": "foundation"
      }
    }
  ]
}
```

`workflow_type` is an optional convenience consumed by `create-from-plan`.
All `planning` fields are optional.

### Validation rules

Validation rejects:

- duplicate task ids
- unknown dependencies
- self dependencies
- duplicate dependencies
- dependency cycles
- empty task lists
- required capabilities that do not exist in `team.yaml`
- tasks assigned to `reviewer` or `qa` — review and QA are quality gates
  handled by the existing Phase 10 system (`run-quality-gate.ts`); the runtime
  scheduler never dispatches them as normal tasks

Conflict-domain overlap produces a **warning**, not a rejection (see below).

---

## Task Metadata

`planning` is fully optional; existing graphs without it remain valid.

```ts
planning?: {
  priority?: "low" | "normal" | "high" | "critical";
  estimated_complexity?: "small" | "medium" | "large";
  risk?: "low" | "medium" | "high";
  expected_files?: string[];
  conflict_domains?: string[];
  parallel_group?: string;
}
```

`routing` keeps its Phase 9 shape (`mode`, `required_capabilities`,
`preferred_agents`) and is preserved end-to-end: plan → task graph → workflow
state → scheduler routing decisions.

---

## Conflict Domains

Two tasks that are **dependency-independent** (neither can reach the other
through the dependency graph) but declare the same `conflict_domains` entry are
reported:

```
⚠ Tasks AUTH-API and AUTH-REFRESH are dependency-independent but share conflict domain 'auth-core'.
```

By design this does **not** fail validation and does **not** invent
dependencies. Reusable helpers for the scheduler are exported from
`scripts/lib/task-graph-analysis.ts`:

- `getTransitiveDependencies(taskId, tasks)`
- `areDependencyIndependent(aId, bId, tasks)`
- `findConflictDomainWarnings(tasks)`

A later phase can use these to serialize risky pairs at scheduling time.

---

## Graph Analysis

`analyzeTaskGraph(tasks)` reports:

- number of tasks and dependency edges
- root tasks (no dependencies) and leaf tasks (nothing depends on them)
- maximum dependency depth (longest chain, counted in edges)
- parallelizable groups (tasks grouped by dependency level)
- conflict-domain warnings
- tasks without required capabilities
- high-risk tasks (`planning.risk === "high"`)
- tasks without acceptance criteria

Example CLI output:

```
Graph analysis:
Tasks: 5
Edges: 5
Max depth: 2
Parallel roots: 1
Conflict warnings: 1
High-risk tasks: 2
Leaf tasks: AUTH-UI, AUTH-TEST
Parallelizable groups:
  Level 0: AUTH-DB
  Level 1: AUTH-API, AUTH-REFRESH
  Level 2: AUTH-UI, AUTH-TEST
Conflict warnings:
  ⚠ Tasks AUTH-API and AUTH-REFRESH are dependency-independent but share conflict domain 'auth-core'.
```

---

## Planning Command

```bash
# Full pipeline: run the Planner agent through OpenCode
npx tsx scripts/plan-workflow.ts feature "Add JWT authentication with PostgreSQL and a Next.js login page"

# Offline pipeline: validate/normalize/analyze an existing planner JSON
npx tsx scripts/plan-workflow.ts feature "Add JWT auth" --name jwt-auth --plan-file examples/planner-result.example.json

# Analyze only
npx tsx scripts/plan-workflow.ts analyze plans/jwt-auth-<id>/planner-result.json
```

Behavior:

1. Load `team.yaml`; collect real agents + capabilities.
2. Build the planner prompt (rules embedded; only real capabilities offered).
3. Run `opencode run ... --agent planner --format json` (or read `--plan-file`).
4. Save raw output to `plans/<plan-id>/planner-result.raw.txt`.
5. Extract the JSON object; save `planner-result.raw.json`.
6. Normalize small safe schema differences (trim strings, default missing
   arrays, drop empty/duplicate list entries, ignore unknown enum values so
   they fail validation cleanly).
7. Validate: JSON schema → semantic graph rules → capability awareness.
8. Persist canonical artifacts:
   - `plans/<plan-id>/planner-result.json` (normalized plan)
   - `plans/<plan-id>/task-graph.json` (canonical task graph)
9. Print the plan summary and graph analysis.

Invalid graphs are rejected with a clear error; nothing is persisted except
the raw artifacts used for debugging.

---

## Workflow Creation From a Generated Plan

```bash
npx tsx scripts/workflow-state.ts create-from-plan plans/<plan-id>/planner-result.json [name] [--type feature|bugfix|refactor]
```

- Accepts either a planner result (`goal`/`summary`/`tasks`) or a plain task
  graph file (`tasks` only).
- Re-validates the plan (schema + semantics + capabilities against
  `team.yaml`).
- Creates a normal `WorkflowState` via the same shared code path as
  `workflow-state.ts create`.
- Preserves routing and planning metadata on every task.
- Compatible with `run-workflow.ts`, `dispatch-workflow.ts`,
  `integrate-workflow.ts`, and `run-quality-gate.ts` without changes.
- Workflow type resolution: `--type` flag > `workflow_type` in the plan >
  `feature`.

---

## Examples

See `examples/planner-result.example.json` for a complete JWT-authentication
plan producing:

```
AUTH-DB
  ↓
AUTH-API ──┬── AUTH-UI
           └── AUTH-TEST
AUTH-REFRESH ──┘ (joins at AUTH-TEST)
```

with conflict domain `auth-core` shared by the two independent backend tasks
(AUTH-API, AUTH-REFRESH) and capability routing throughout.

Validate it manually:

```bash
npx tsx scripts/validate-team.ts planner-result examples/planner-result.example.json
npx tsx scripts/plan-workflow.ts analyze examples/planner-result.example.json
```

---

## Backward Compatibility

- Existing task graphs **without** `routing`/`planning` remain valid
  (schema-wise and semantically). Verified against
  `task-graph.example.json`.
- Existing graphs **with** `routing` (Phase 9) remain valid.
- All existing commands keep their interfaces:
  - `workflow-state.ts create|list|use|status|ready|start|complete|fail|block|reset`
  - `run-workflow.ts`, `dispatch-workflow.ts`, `integrate-workflow.ts`,
    `integrate-review-fixes.ts`, `execute-request.ts`, `route-workflow.ts`,
    `worktree-clean.ts`, `run-quality-gate.ts review|qa`
- `validate-team.ts task-graph` behaves exactly as before (plus the schema now
  also accepts `planning`).
- The only behavioral tightening: `workflow-state.ts create` now also runs the
  semantic validators (duplicate ids / unknown deps / cycles) before creating a
  workflow. Previously invalid graphs would have broken the scheduler later;
  valid graphs are unaffected.
- `RuntimeTask` lease fields (`max_attempts`, `lease_id`,
  `lease_expires_at`) are now typed as optional, matching reality: they are
  assigned when the scheduler claims a task. Persisted state files are
  unchanged.

---

## Tests

```bash
npm run typecheck   # tsc -p tsconfig.typecheck.json (strict)
npm test            # node --import tsx --test "tests/*.test.ts"
```

Suites:

- `tests/task-graph-planner.test.ts` — valid DAG acceptance, duplicate id /
  unknown dep / self dep / cycle rejection, unknown-capability rejection,
  reviewer/qa gate-agent rejection, empty task list rejection, normalization,
  plan→graph metadata preservation, legacy graph compatibility
- `tests/task-graph-analysis.test.ts` — depth calculation, edge/root/leaf
  counting, parallel group detection, conflict-domain warnings (positive and
  negative), transitive ordering safety, quality findings, CLI formatting
- `tests/workflow-create.test.ts` — runtime task mapping, workflow creation
  preserving routing/planning in `state.json` / `task-graph.json` /
  `history.json` / active pointer, invalid-graph rejection (runs in a temp
  working directory)
- `tests/schema-compat.test.ts` — Ajv compilation of `task.schema.json` and
  `planner-result.schema.json`, legacy/planned task acceptance, enum and
  additional-property rejection

---

## Known Limitations

- Conflict-domain warnings are informational; the scheduler does not yet use
  them to serialize dispatch (helpers are exported for a later phase).
- The planner prompt provides repository context by letting the planner agent
  inspect the working directory; there is no explicit repo snapshot embedded
  in the prompt.
- Planner output extraction relies on the OpenCode text protocol
  (`--format json` events) plus fenced/raw JSON recovery; heavily malformed
  output fails with the raw text saved for debugging.
- `plans/` artifacts are local (gitignored), matching how `tasks/*/` runtime
  state is treated.
- Deliberately out of scope (later phases): automatic retry for provider
  429/503, multi-provider execution, web UI/dashboard, Telegram integration,
  automatic PR creation, token/cost analytics, full Phase 13 resilience.
