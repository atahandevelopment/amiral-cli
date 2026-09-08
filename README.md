<a id="top"></a>

[English](./README.md) | [Türkçe](./README_TR.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md)

![Amiral AI](./assets/amiral-ai.png)

# Amiral AI

> A dependency-aware engineering workflow for AI coding teams.

Amiral is a dependency-aware multi-agent software engineering orchestrator. It coordinates coding agents instead of replacing them, giving them a structured delivery process with isolated execution, persistent workflows, controlled integration, independent review, and QA.

**Don't just run more agents. Give them an engineering process.**

```text
Plan → Decompose → Schedule → Execute → Integrate → Review → Fix → QA → Complete
```

## Table of Contents

- [Why Amiral?](#why-amiral)
- [How it works](#how-it-works)
- [Key differentiators](#key-differentiators)
- [Quick start](#quick-start)
- [How Amiral differs](#comparison)
- [Framework positioning](#framework-positioning)
- [Philosophy](#philosophy)
- [Prerequisites and installation](#installation)
- [Initialization](#initialization)
- [Configuration and project discovery](#configuration)
- [Optional UI/UX design and Browser Visual QA](#ui-workflow)
- [Command reference](#commands)
- [Persistence, stopping, and resume](#persistence)
- [Troubleshooting](#troubleshooting)
- [Architecture and repository layout](#architecture)

<a id="why-amiral"></a>
## Why Amiral?

How do you safely coordinate multiple coding agents working on the same software project? Launching several agents does not decide who owns each task, what must finish first, which work can safely overlap, or how independent changes become one reviewed result.

Amiral provides that coordination layer. It decomposes requests, models dependencies, schedules within capacity, isolates changes, integrates them deliberately, enforces Reviewer and QA gates, records failures, and resumes interrupted work. The benefit comes from explicit process and responsibility—not agent count alone.

<a id="how-it-works"></a>
## How it works

```text
User Request
     │
     ▼
   Planner ──► Dependency Graph
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Backend worktree    Frontend worktree
          └─────────┬─────────┘
                    ▼
              Integration
                    ▼
                 Review
             changes requested?
               │           │
              yes          no
               ▼            ▼
           Fix Tasks       QA
               └───────────►│
                            ▼
                         Complete
```

<a id="key-differentiators"></a>
## Key differentiators

### Planning is a first-class artifact

`amiral plan "Add authentication"` validates and persists an inspectable, reusable plan under `plans/`; it does **not** implement it. This supports human review or approval before `amiral run --plan <plan-id>` executes the saved graph.

### Dependency-aware execution

Parallelism does not mean “launch as many agents as possible.” A task becomes schedulable only when its dependencies are complete. Independent tasks may run concurrently when safe and within configured agent/provider capacity.

```text
DB-001 ─────► API-001 ─────► UI-002
                    │
                    └──────► TEST-001

UI-001 ────────────────────► UI-002
```

### Specialized roles and isolated delivery

The supplied roles are Lead, Planner, Frontend, Backend, Database, DevOps, Reviewer, and QA. The Planner plans but does not implement; implementation agents work on assigned tasks; Reviewer evaluates the integrated result independently; QA verifies it independently.

Implementation agents use isolated Git worktrees. Worktree isolation is not presented as unique; its value here is its place in the complete lifecycle:

```text
repository
├── main workspace
├── .amiral/worktrees/<workflow-id>/...
└── .amiral/integration/<workflow-id>/...

task execution → isolated worktrees → integration workspace → review → QA
```

### Independent Review and QA gates

Review is a gate, not a suggestion. Its statuses are `PASS`, `CHANGES_REQUESTED`, and `BLOCKED`. Changes requested create fix tasks and another review, bounded by `quality.max_review_rounds` (a positive integer, default `3`); Amiral does not claim unlimited autonomous fixing.

For applicable, non-trivial workflows, completion means implementation and integration succeeded, Review returned `PASS`, and QA returned `PASS`. “The agent finished coding” is not the definition of done; this process does not guarantee more than the checks actually performed.

### Persistent workflows, explicit outcomes, automation-friendly CLI

Workflow state and history are persisted as local JSON. Resume continues existing state rather than re-planning:

```bash
amiral status
amiral workflow history <workflow-id>
amiral run --workflow <workflow-id>
```

Task states are `pending`, `in_progress`, `retry_wait`, `completed`, `failed`, `blocked`, and `cancelled`. Workflow states are `planned`, `running`, `blocked`, `failed`, `completed`, and `cancelled`. These persisted states are distinct from `run` stop reasons: `completed`, `retry_scheduled`, `failed`, `blocked`, `needs_input`, `max_review_rounds`, `no_progress`, and `interrupted`. Keeping them explicit prevents failed or paused automation from appearing complete.

Global JSON output, diagnostics, retry/history controls, and stable exit-code categories support scripts, CI environments, and future control planes without claiming built-in CI orchestration.

<a id="quick-start"></a>
## Quick start

```bash
npm install --global amiral-ai
cd my-project
git init # only when needed
amiral init
amiral doctor
amiral plan "Add authentication"
amiral run --plan <generated-plan-id>
```

One-step alternative:

```bash
amiral run "Add authentication"
```

`plan` = inspect before implementation; `run` = execute.

<a id="comparison"></a>
## How Amiral differs

| Capability | Single coding agent | Parallel agent launcher | General multi-agent framework | Amiral |
| --- | --- | --- | --- | --- |
| Specialized agents | Limited | Usually | Framework-dependent | Supplied roles |
| Isolated Git worktrees | Usually no | Often | Custom | Yes |
| Persistent dependency graph and scheduling | Usually no | Varies | Build/configure it | Yes |
| Saved plan without execution | Varies | Varies | Build/configure it | Yes |
| Controlled integration workspace | Usually no | Varies | Custom | Yes |
| Independent Review → fix gate | Varies | Varies | Custom | Yes |
| Independent QA gate | Rare | Varies | Custom | Yes |
| Persistent/resumable workflow | Varies | Varies | Custom | Yes |
| Retry/history and machine-readable CLI | Limited | Varies | Framework-dependent | Yes |

Parallel launchers answer how to run work simultaneously; Amiral also answers who owns it, what must finish first, how results integrate, who reviews and tests them, and what happens after failure or interruption.

<a id="framework-positioning"></a>
## Framework positioning

General multi-agent frameworks provide primitives for arbitrary agent systems and may be the right abstraction when building a custom platform. Amiral is opinionated specifically around software delivery:

```text
Requirement → Engineering Plan → Task Dependencies → Specialist Implementation
→ Git Integration → Code Review → QA → Completed Change
```

<a id="philosophy"></a>
## Philosophy

Plans should be inspectable. Dependencies should control execution. Parallel agents should be isolated. Integration should be deliberate. The code-writing agent should not be the only judge. Failures should remain failures until resolved, and interrupted workflows should be resumable.

> AI agents should work like an engineering team—not a collection of unrelated terminals.

[↑ Back to top](#top)

<a id="installation"></a>

## The most important distinction: `plan` does not execute

> **`amiral plan` creates and validates a reusable plan, writes it under `plans/`, prints the plan ID, and exits. It intentionally does not create or execute a workflow.**
>
> **`amiral run` executes.** Given a request, it first plans and then creates and runs a workflow. It can also execute a saved plan or resume a persisted workflow.

Choose the command by intent:

| You want to... | Use |
| --- | --- |
| Inspect or approve a task graph before any implementation starts | `amiral plan "Add authentication"` |
| Execute that approved plan | `amiral run --plan feature-ab12cd34` |
| Plan and execute in one command | `amiral run "Add authentication"` |
| Continue an interrupted, paused, or retried workflow | `amiral run --workflow feature-ab12cd34` |
| Continue the currently selected workflow | `amiral run` |

```bash
# Two-step, review-before-execution flow
amiral plan "Add authentication" --type feature
# Output includes: Plan created: feature-ab12cd34
amiral run --plan feature-ab12cd34

# One-step flow: the same request is planned and then executed
amiral run "Add authentication" --type feature
```

`--plan` on `run` accepts either a plan ID under `plans/` or an existing plan/graph file. Do not use `amiral run --plan ...` expecting it to create a plan; it consumes one.

## Prerequisites

- Node.js **20 or newer** and npm.
- Git, with the target directory initialized as a repository. `amiral init` never runs `git init`.
- The configured provider CLI. The supplied configuration uses the `opencode` executable; install it, authenticate it according to OpenCode's instructions, and ensure it is on `PATH`.
- A clean working tree before integration. Amiral preserves unrelated user changes and will not integrate into a dirty tree.
- Provider access, models, and credentials appropriate to your OpenCode setup. Do not put secrets in tracked configuration.

Confirm readiness with `amiral doctor` and `amiral config validate` after initialization.

## Installation and invocation

### Global installation

```bash
npm install --global amiral-ai
amiral --version
amiral --help
```

### Project-local installation

```bash
npm install --save-dev amiral-ai
npx amiral --version
```

You can also add a package script, for example `"amiral": "amiral"`, then run `npm run amiral -- status`.

### Run without installing

```bash
npx --yes amiral-ai --version
npx --yes amiral-ai init --minimal
```

`npm run build` is only for developing this repository; it is not required after installing the published package. With a local install, prefer `npx amiral` so the project-local binary is used. With no local install, `npx amiral-ai ...` identifies the npm package unambiguously.

### Verify the package and version

```bash
amiral --version                         # active global/PATH binary
npx amiral --version                     # local binary, when installed
npm view amiral-ai version               # current registry version
npm list amiral-ai                       # local installed version
npm list --global amiral-ai              # global installed version
```

The package version is read from its installed `package.json`; this repository currently declares **0.1.5**. If an upgrade still reports an old version, determine which executable is being resolved (`where amiral` on Windows, `which -a amiral` on macOS/Linux), remove conflicting global/local installs, clear only npm's normal cache if npm reports corruption, and reinstall. Avoid blindly combining a stale global binary with a newer local package.

```bash
npm update --save-dev amiral-ai           # update a local dependency within its range
npm install --global amiral-ai@latest     # replace the global package
npx --yes amiral-ai@latest --version      # explicitly use the latest registry release
```

Reinstalling the CLI does not migrate or delete project runtime state. Review release changes before using a newer CLI against existing `tasks/` data.

<a id="initialization"></a>
## Initialize a project

Run initialization in the intended project root:

```bash
git init                                  # only if this is not already a Git repository
amiral init --minimal
amiral doctor
amiral config validate
```

```text
amiral init [--minimal] [--force]
```

- `--minimal`: install only `team.yaml`, workflow definitions, schemas, and the machine planning agent; bundled skills are not read, validated, or installed.
- `--force`: overwrite existing template files. Use carefully; without it, existing files are retained.

Full initialization installs the whitelisted templates in `team.yaml` and `.opencode/` (agents, workflows, contracts, orchestration, policies, prompts, schemas, and OpenCode configuration), then copies the packaged `vendor/skills/**` tree to the target's `vendor/skills/**`. Initialization also adds a marker-delimited Amiral block to `.gitignore`; it does not duplicate the block and does not overwrite content outside it. It rejects unsafe symbolic-link destinations and never installs package manifests, dependencies, or runtime state.

<a id="configuration"></a>
## Project-root discovery

Except for `init`, commands can be run in the project root or any nested directory, including paths containing spaces. Amiral walks upward:

1. The nearest ancestor containing `team.yaml` wins.
2. If no `team.yaml` is found, the first ancestor containing `.amiral` or `.opencode` is a fallback.
3. If none exists, the command fails and suggests `amiral init`.

The process then operates from the discovered root. `doctor` is special: it can diagnose the current directory even when no Amiral root is found, and `doctor --fix` can create missing support directories/minimal files there.

## Requests: positional `goal` versus `--request`

The complete original user request is authoritative input to planning.

- Use the positional `[goal]` for the entire request in ordinary usage.
- When the positional goal is only a short title, place the full requirements in `--request`.
- If both are supplied, non-empty `--request` is the complete authoritative request; the short goal is not concatenated with it.
- If `--request` is absent, `goal` becomes the complete request.
- `--plan-file` imports a plan and therefore does not require either text argument.

```bash
# Full request in the positional argument
amiral plan "Add password reset with expiring one-use tokens and integration tests"

# Short display-level idea plus the complete authoritative request
amiral run "Password reset" \
  --request "Add email-based password reset. Tokens expire after 15 minutes, are one-use, and must be covered by integration tests." \
  --type feature
```

Shell quoting matters. Quote requests containing spaces; use your shell's continuation syntax or a single line for long requests. Avoid putting secrets in command arguments because shells and process tools may record them.

## Operating model

```text
User request
    ↓
Lead / workflow selection
    ↓
Planner → validated dependency graph
    ↓
Specialists in isolated Git worktrees
    ↓
Integration worktree
    ↓
Reviewer ── CHANGES_REQUESTED → fix tasks → review again
    ↓ PASS
QA ──────── FAIL/BLOCKED → stop for input
    ↓ PASS
Complete
```

Core principles:

- Inspect the existing repository before making architectural decisions; follow existing conventions.
- The Lead is the sole orchestration authority. The Planner analyzes and decomposes but does not implement.
- Frontend, backend, database, and DevOps specialists implement only assigned work.
- A task is schedulable only after all dependencies are complete. Independent tasks may run concurrently only within configured provider/agent capacity and when safe.
- Work is isolated in task worktrees and merged idempotently into an integration worktree.
- Reviewer and QA are independent gates. A non-trivial workflow is complete only after implementation, integration, review `PASS`, and QA `PASS`.
- Review `CHANGES_REQUESTED` creates fix tasks up to `quality.max_review_rounds`; blocking/exhausted gates do not become false successes.
- Preserve unrelated changes, avoid destructive Git actions, and never expose credentials.

The supplied `team.yaml` defines agents, capabilities, provider routing/capacity, leases, retries, Git retention, and the `feature`, `bugfix`, and `refactor` workflows. The scheduler uses task dependencies and required capabilities; effective parallelism is bounded by `execution.max_parallel_agents` and provider concurrency (both default to 1 in the supplied configuration).

<a id="ui-workflow"></a>
## Optional UI/UX design and Browser Visual QA

UI support is opt-in and preserves the normal workflow when omitted or disabled. The supplied `team.yaml` includes a disabled `ui` section with `ui.enabled: false`. For online planning, Amiral invokes the read-only `uiux-designer` before the Planner only when `ui.enabled` is true and the request is conservatively classified as material user-facing work (for example, layout, responsive behavior, interactions, motion, or accessibility). Copy-only, visually immaterial, and backend-only requests do not activate it. Imported plans (`--plan-file`) do not run this design pass.

`uiux-designer` may selectively load the bundled `ui-ux-pro` skill when detailed direction is needed; it does not load it for backend/copy-only work or when an approved specification already determines the UI. The skill reads only relevant references, prefers the repository's components and tokens, and provides reasoning rather than implementation. The designer writes no files itself: orchestration validates its JSON and persists `plans/<plan-id>/uiux-design-spec.json` plus `uiux-design-diagnostics.json`. The specification contains `version`, `name`, `summary`, and one or more route entries with `path`, `description`, and observable `acceptance_criteria`; frontend tasks receive the specification as an artifact reference. Designer output validation has at most three attempts.

After frontend work is integrated, Browser Visual QA runs **before** the existing Review and QA gates. It compares the integration workspace against the design specification at configured viewports. Results include a structured `outcome_code` and are written inside that integration worktree at `.amiral/gates/visual-qa-iteration-<n>.json`; the latest result is `.amiral/gates/visual-qa-result.json`. `critical` and `high` findings can create targeted frontend fix tasks before the next iteration. `medium` and `low` findings are recorded but do not create these automatic fixes. `PASS` requires a ready server and zero findings. When the iteration budget is reached, unresolved `critical`/`high` findings block the workflow; Review and QA do not silently continue.

```yaml
ui:
  enabled: true
  designer: uiux-designer
  skill: ui-ux-pro
  # style_preset: product-archetype-name
  animation:
    enabled: false
    intensity: none
  allowed_hosts: []
  routes:
    include: []
    exclude: []
  server:
    # start_command: npm run dev
    # ready_url: http://localhost:3000
    startup_timeout_ms: 60000
    shutdown_timeout_ms: 10000
  visual_qa:
    enabled: false
    # provider: registered-browser-adapter
    max_iterations: 2
    viewports:
      - { width: 1440, height: 900 }
      - { width: 1024, height: 768 }
      - { width: 768, height: 1024 }
      - { width: 390, height: 844 }
```

All fields above are optional. Exact normalized defaults are: `enabled: false`, `designer: uiux-designer`, no `skill` or `style_preset`, `animation.enabled: false`, `animation.intensity: none`, empty `allowed_hosts`, `routes.include`, and `routes.exclude`, no server command or ready URL, server timeouts of 60,000/10,000 ms, and Visual QA disabled with no provider, two iterations, and the four viewports shown. Booleans must be booleans; timeouts, dimensions, and `max_iterations` must be positive integers; string fields must be non-empty; string arrays must contain unique non-empty values. `animation.intensity` is `none`, `subtle`, `moderate`, or `expressive`. The designer cannot be `planner`, `reviewer`, or `qa`.

`style_preset` is optional prompt direction, not a theme installer. This release ships no preset and never selects one implicitly or imitates a named company; an existing design system and explicit requirements take priority. Likewise, animation settings communicate a motion budget to the design pass rather than injecting runtime animation. The bundled guidance favors purposeful feedback (roughly 100–150 ms), standard transitions (150–250 ms), larger spatial transitions (250–400 ms), avoids motion over 500 ms, never delays task completion, and honors reduced-motion preferences.

Design prompting uses the configured default prompt transport, while Browser Visual QA uses the provider-neutral `VisualQAProvider` registry and the optional `ui.visual_qa.provider` name. The built-in `playwright` adapter dynamically uses a project-installed Playwright package (it never installs one), captures route/viewport screenshots, and reports deterministic findings. Disabled Visual QA, an unconfigured/uninstalled provider, or an unavailable design artifact is recorded and skipped. A configured startup failure, missing `ready_url`, provider runtime failure, or exhausted critical/high findings blocks the workflow.

Browser/server controls are deliberately narrow: readiness and navigation permit credential-free HTTP(S) only; loopback hosts are allowed by default and additional exact hostnames require `allowed_hosts`. `start_command` is parsed into arguments without a shell and rejects shell operators. Amiral probes an already-running server without taking ownership; it terminates only a process it started, using the shutdown timeout before a forced kill. Common credentials are redacted from bounded diagnostics. Do not place secrets in URLs, commands, artifacts, or tracked configuration.

The extra designer call, up to three correction attempts, skill references, viewport evaluation, and repeated Visual QA iterations consume additional model context/tokens and runtime; keep activation, references, routes, viewports, and `max_iterations` selective. The core enforces configured route include/exclude policy before invoking the provider.

The npm package includes `templates/` and `vendor/skills`. A normal `amiral init` installs the `uiux-designer` agent and design/Visual-QA schemas with the other templates, then copies `vendor/skills/ui-ux-pro`; existing files are retained unless `--force` is used. `amiral init --minimal` deliberately neither reads nor installs bundled skills and excludes the optional designer agent, while still installing its minimal schema set. Initialization does not enable UI processing or add a `ui` section automatically.

## Global flags and output

These flags may be placed before or after a subcommand; command-specific `--json`/`--verbose` forms are also accepted where declared.

| Flag | Meaning |
| --- | --- |
| `-q, --quiet` | Suppress normal output where commands use the standard output renderer. `config path` and non-JSON `config show` currently write directly to stdout. |
| `-v, --verbose` | Include diagnostic/progress events where supported. |
| `--json` | Emit one JSON document for successful command output. |
| `-V, --version` | Print the package version. |
| `-h, --help` | Show help; use after any command/subcommand for scoped help. |

For automation, use `--json` and check the exit code:

```bash
amiral --json status > status.json
amiral doctor --json > doctor.json
amiral config show --json > config.json       # secret-like keys are redacted
amiral workflow list --json
```

Normal JSON output goes to stdout as one document. Errors go to stderr; in JSON mode they have the shape `{"error":{"message":"...","code":N}}`. Verbose provider progress is suppressed during JSON-producing planning/run/gate commands so stdout remains parseable. Interactive commands still require `--force` in non-TTY automation where documented.

`doctor` is a diagnostic exception: it currently exits `0` after completing its checks even when some checks fail. Automation must inspect the JSON `failures` count or each `checks[].state`; do not treat its exit code alone as a readiness result.

Exit codes are stable CLI categories:

| Code | Meaning |
| ---: | --- |
| 0 | Success; also used when `run` pauses for a scheduled transient retry. |
| 1 | General failure or no progress. |
| 2 | Invalid usage or declined/required confirmation. |
| 3 | Missing/invalid configuration. |
| 4 | Workflow blocked, gate not passing, lock/admin conflict, or input required. |
| 5 | Provider failure. |
| 6 | Validation/schema failure. |
| 130 | Interrupted. |

<a id="commands"></a>
## Command reference

### `amiral plan`

```text
amiral plan [goal]
  --type <feature|bugfix|refactor>   default: feature
  --request <text>                   complete original request
  --name <name>                      prefix used in generated plan ID
  --plan-file <file-or-plan-id>      import and validate planner-format JSON
  --json
```

Runs the planning provider (unless importing), validates and analyzes the graph, saves artifacts under `plans/<plan-id>/`, reports task count/depth/parallel groups/conflict warnings, and **exits without implementation**.

```bash
amiral plan "Repair duplicate invoice creation" --type bugfix --name invoice-race
amiral plan --plan-file ./approved-plan.json --type refactor --json
```

Imported `--plan-file` content must be planner-format JSON; `plan` writes a new normalized plan directory. To execute an already saved graph directly, use `run --plan`.

### `amiral run`

```text
amiral run [goal]
  --plan <id-or-file>
  --workflow <id>
  --type <feature|bugfix|refactor>   default: feature
  --request <text>
  --name <name>
  --plan-file <file-or-plan-id>
  --json
```

Exactly one execution mode may be selected:

1. `[goal]`, `--request`, or `--plan-file`: create a plan, create a workflow, then execute it.
2. `--plan <id-or-file>`: validate a saved planner result/task graph, create a workflow, then execute it.
3. `--workflow <id>`: resume that persisted workflow.
4. No mode: resume the active workflow (or the sole workflow if none is selected).

`--name` names newly generated plan/workflow IDs; it does not rename an existing workflow. `--type` controls new online planning and is the fallback when an imported graph does not carry a workflow type.

```bash
amiral run "Add favorites" --type feature
amiral run --plan feature-ab12cd34
amiral run --plan ./plans/reviewed/task-graph.json --name favorites-approved
amiral run --workflow feature-cd34ef56 --verbose
amiral run                              # active workflow
```

`run` holds the runtime lock and iterates through scheduling, provider dispatch, integration, review/fix rounds, and QA. It returns when complete or at a safe pause condition; it is not a daemon.

### `amiral status`

```text
amiral status [--workflow <id>] [--json] [--verbose]
```

Shows workflow status, the configured default provider name, task counts and retry/provider-error details, quality state, and active worktrees. It does not perform a live provider health or authentication check; use `doctor` for diagnostics. Without `--workflow`, it resolves the active/sole workflow.

```bash
amiral status
amiral status --workflow feature-cd34ef56 --json
```

### `amiral workflow`

Administrative and inspection subcommands:

```text
amiral workflow list
amiral workflow use <id>
amiral workflow show <id> [--json]
amiral workflow cancel <id> [--force]
amiral workflow reset-task <task-id> [--workflow <id>] [--force]
amiral workflow history [id] [--limit <positive-integer>]   default: 20
```

- `list`: list IDs, statuses, active selection, and update times.
- `use`: write the active workflow selection used by commands without an ID.
- `show`: show graph goal/summary when available and task details.
- `cancel`: cancel a workflow and release leases. It prompts in a TTY; non-interactive use requires `--force`.
- `reset-task`: manually return one task to retryable state. `--workflow` disambiguates it; `--force` permits otherwise restricted reset cases. This subcommand does not prompt.
- `history`: show newest requested history view up to `--limit`; omit ID to use active resolution.

```bash
amiral workflow list
amiral workflow use feature-cd34ef56
amiral workflow show feature-cd34ef56 --json
amiral workflow history feature-cd34ef56 --limit 50
amiral workflow cancel obsolete-workflow --force
amiral workflow reset-task API-002 --workflow feature-cd34ef56 --force
```

### `amiral retry`

```text
amiral retry <task-id> [--workflow <id>] [--force]
amiral retry --failed [--workflow <id>]
amiral retry --blocked [--workflow <id>]
```

Select exactly one task ID, `--failed`, or `--blocked`. It resets matching tasks but preserves their worktrees; it does not execute them. Follow with `amiral run --workflow <id>` (or `amiral run` for the active workflow).

```bash
amiral retry API-002 --workflow feature-cd34ef56
amiral retry --failed --workflow feature-cd34ef56
amiral run --workflow feature-cd34ef56
```

### `amiral review` and `amiral qa`

```text
amiral review [--workflow <id>] [--json]
amiral qa     [--workflow <id>] [--json]
```

Run a standalone gate against the selected workflow/integration workspace. Review reports verdict, summary, and findings; QA reports verdict, checks, and findings. A verdict other than `PASS` exits with code 4. These commands run a gate only; they do not replace `run`'s complete lifecycle or automatically execute resulting fixes.

```bash
amiral review --workflow feature-cd34ef56
amiral qa --workflow feature-cd34ef56 --json
```

### `amiral clean`

```text
amiral clean [--workflow <id> | --all]
  [--completed] [--remove-failed] [--remove-blocked]
  [--delete-branches] [--dry-run] [--force]
```

Cleanup is conservative:

- With no cleanup policy selector, it previews completed-worktree cleanup only; no files are deleted.
- `--dry-run` always previews.
- `--completed` enables removal of completed worktrees.
- `--remove-failed` / `--remove-blocked` opt into deleting retained failed/blocked worktrees.
- `--delete-branches` opts into branch deletion; branches are kept otherwise.
- Scope defaults to the active workflow; choose one `--workflow` or `--all`, never both.
- Actual cleanup prompts in a TTY and requires `--force` in non-interactive environments.
- The current preview reports overall worktree usage. Its displayed scope is contextual metadata, not an exact per-worktree deletion plan filtered to `--workflow`.

```bash
amiral clean --workflow feature-cd34ef56 --dry-run
amiral clean --workflow feature-cd34ef56 --completed
amiral clean --all --completed --remove-failed --delete-branches --force
```

### `amiral doctor`

```text
amiral doctor [--json] [--fix]
```

Checks project layout, Git/provider/configuration health, runtime directories, and stale worktrees. `--fix` performs limited support repair: ensures `.amiral/worktrees`, `.amiral/integration`, and `tasks`, runs minimal initialization, and ensures the marker-managed `.gitignore` block. It is not a general auto-repair tool and does not initialize Git or authenticate a provider.

```bash
amiral doctor --json
amiral doctor --fix
```

### `amiral config`

```text
amiral config path
amiral config show [--json]
amiral config validate [--json]
```

- `path`: print the discovered absolute `team.yaml` path.
- `show`: print normalized configuration, effective execution/provider capacity, and registered providers. Keys matching token/key/secret/password are recursively replaced with `[REDACTED]`.
- `validate`: verify the default provider is registered/enabled and that configuration contains at least one object-valued agent definition; output includes provider/capacity data. It does not deeply validate every agent field or corresponding agent file.

```bash
amiral config path
amiral config show --json
amiral config validate
```

Redaction is a display safeguard, not permission to store secrets in `team.yaml`.

<a id="persistence"></a>
## Persistence, stopping, and resume

Plans and workflows are different persistent objects:

```text
plans/<plan-id>/
├── planner-result.json
├── task-graph.json
├── planner-result.raw.txt
├── planner-result.raw.json
└── planner-diagnostics.json          # online planning; failed attempts may also be saved

tasks/
├── .active-workflow
└── <workflow-id>/
    ├── state.json
    ├── task-graph.json
    ├── history.json
    ├── requests/                     # directory name is configurable
    └── results/

.amiral/
├── amiral.lock
├── amiral.lock.guard                 # transient internal mutex; stale recovery may remove it
├── worktrees/<workflow-id>/...       # task worktrees
└── integration/<workflow-id>/...     # integrated tree and gate artifacts
```

These paths are local runtime artifacts and the initializer adds them to `.gitignore`. There is no documented SQLite state store: JSON files are authoritative. Do not hand-edit state while a command holds `.amiral/amiral.lock`.

Workflow resolution without `--workflow` uses `tasks/.active-workflow`; if absent, a sole workflow is selected automatically, while multiple workflows require `amiral workflow use <id>` or an explicit ID.

`run` stops safely for these reasons:

- `completed`: all implementation/fix work integrated, review passed, and QA passed.
- `retry_scheduled`: transient provider retry is waiting; exit code 0, with `nextRetryAt` when known. Run again after that time.
- `failed`: non-retryable/exhausted task failure; inspect state/results, reset with `retry`, then run again.
- `blocked`: workflow/task blocking; inspect status/history and resolve or manually reset as appropriate.
- `needs_input`: cancelled workflow, blocked/failed gate, review-fix exhaustion, or the 25-iteration safety bound. The safety-bound message explicitly permits another run.
- `max_review_rounds`: review changes could not progress within configured rounds; workflow is blocked.
- `no_progress`: no schedulable task and no pending retry; inspect dependencies and history.
- `interrupted`: the first `SIGINT`/`SIGTERM` requests a safe stop before the next mutation and exits 130. A second signal terminates immediately, so use it only when necessary.

Resume does not re-plan:

```bash
amiral status --workflow feature-cd34ef56
amiral workflow history feature-cd34ef56 --limit 50
amiral run --workflow feature-cd34ef56
```

Commands that mutate shared runtime state use a project lock. If another process owns it, wait for that process or diagnose a genuinely stale owner; do not delete an active lock blindly.

<a id="troubleshooting"></a>
## Troubleshooting

### “No Amiral project found”

Run from the intended tree, verify `team.yaml` exists in an ancestor, or initialize the project. `amiral config path` confirms discovery.

### Provider executable/authentication failure

Run `amiral doctor --verbose` and `amiral config show`; verify `providers.<name>.binary`, `enabled`, PATH resolution, and provider login outside Amiral. Provider errors may be retried according to `team.yaml`; diagnostics are persisted for planning failures.

### More than one workflow and none active

```bash
amiral workflow list
amiral workflow use <workflow-id>
```

Alternatively pass `--workflow` explicitly.

### Dirty tree or merge conflict

Commit/stash only your own intended changes, preserve unrelated work, inspect task/integration worktrees, and retry after resolving the underlying Git condition. Do not use destructive resets as a routine fix.

### A run returned successfully but is not complete

Check the JSON/text `reason`. `retry_scheduled` intentionally returns 0 even though execution is paused. Wait until `nextRetryAt`, then resume. Only `reason: "completed"` means all gates passed.

### A task failed or blocked

```bash
amiral status --workflow <id> --json
amiral workflow history <id> --limit 100
amiral workflow show <id> --json
amiral retry <task-id> --workflow <id>
amiral run --workflow <id>
```

Use `--force` only after understanding why a reset/cancellation/cleanup is restricted.

### JSON parsing fails

Put `--json` on the command, parse stdout only, and retain stderr separately. Do not merge streams (`2>&1`) when consuming JSON. Prompts requiring confirmation need `--force` in CI.

<a id="architecture"></a>
## Architecture and repository layout

```text
AGENTS.md                     team-wide operating rules
team.yaml                     agents, providers, capacities, workflows
.opencode/
├── agents/                   role instructions
├── workflows/                feature, bugfix, refactor processes
├── orchestration/            execution/dependency/error protocols
├── contracts/                task, agent-result, review contracts
├── policies/                 architecture, Git, review, testing rules
├── prompts/ and schemas/     machine prompts and validation contracts
└── opencode.json             OpenCode configuration
src/cli/                      product CLI definitions
scripts/lib/                  orchestration runtime
templates/init/               files installed by `amiral init`
vendor/skills/                bundled skills installed by normal `amiral init`
tests/                        Node test suite
memory/                       architecture, conventions, decisions, lessons
```

The active packaged workflows are `feature`, `bugfix`, and `refactor`. Agents include Lead, Planner, Frontend, Backend, Database, DevOps, Reviewer, and QA. Agent definitions describe responsibility; workflows describe process; policies impose cross-cutting rules; contracts define machine-readable handoffs; skills provide specialized knowledge only when relevant.

## Source development

Clone this repository and install the locked dependencies:

```bash
git clone https://github.com/atahandevelopment/amiral-ai.git
cd amiral-ai
npm ci
npm run typecheck
npm test
npm run build
node dist/src/cli/index.js --help
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run typecheck` | Type-check without producing the distributable build. |
| `npm test` | Run the Node test suite through `tsx`. |
| `npm run build` | Compile with `tsconfig.build.json` into `dist/`. |
| `npm run validate:team -- <task-graph|agent-result|review-result|planner-result> <file>` | Validate a JSON contract artifact against the selected schema. |
| `npm pack --dry-run` | Inspect publish contents; `prepack` cleans and rebuilds `dist`. |

For source-tree CLI testing, build first and invoke `node dist/src/cli/index.js ...`; the published `amiral` binary points to that compiled entry. The legacy `scripts/*.ts` entry points remain compatibility/internal tools, but product usage should prefer the CLI.

## License

This package declares the ISC license in `package.json`.
