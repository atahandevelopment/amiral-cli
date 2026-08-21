# Phase 14 — CLI Productization

Phase 14 makes Amiral an installable, automation-safe CLI while retaining the Phase 1–13 script interfaces.

## Architecture and package layout

```text
amiral command (src/cli)
  → application service (scripts/lib/*-service.ts)
  → workflow, scheduler, provider, gate, and worktree domain modules
```

Commander handlers validate arguments, enter project context, acquire a runtime lock when needed, and render service results. Business logic stays in services/domain modules. Historical `scripts/*.ts` entry points remain thin compatible wrappers. `package.json` exposes `amiral` as `dist/src/cli/index.js`; `npm run build` compiles source and scripts into `dist/`. The version comes from `package.json`. `templates/init/` contains the installable project files and the package whitelist contains only `dist`, `templates`, README, and this document.

## Commands

| Command | Purpose | Example |
| --- | --- | --- |
| `init` | Install project templates | `amiral init --minimal` |
| `plan [goal]` | Produce and validate a task DAG | `amiral plan "Add login" --type feature` |
| `run [goal]` | Plan/create/run or resume orchestration | `amiral run --plan login-ab12cd34` |

### Operational result and exit-code contract

With `--json`, an expected operational outcome is emitted as exactly one JSON document on stdout; stderr remains empty. `run` uses exit 0 for `completed` and `retry_scheduled`, exit 4 for `blocked`, `max_review_rounds`, and `needs_input`, exit 1 for `failed` and `no_progress`, and exit 130 for `interrupted`. Review `CHANGES_REQUESTED`/`BLOCKED` and QA `FAIL`/`BLOCKED` emit their result on stdout and exit 4. Unexpected configuration, validation, or execution exceptions instead emit one error document on stderr and nothing on stdout.

The first SIGINT/SIGTERM requests a clean orchestration stop. A second signal terminates promptly with exit 130; atomic stale-lock recovery makes the abandoned lock recoverable.
| `status` | Summarize tasks, retries, provider and gates | `amiral status --json` |
| `workflow` | `list`, `use`, `show`, `cancel`, `reset-task`, `history` | `amiral workflow show <id>` |
| `retry` | Retry one task or failed/blocked tasks | `amiral retry API-1` |
| `review` | Run the review quality gate | `amiral review --workflow <id>` |
| `qa` | Run the QA quality gate | `amiral qa --workflow <id>` |
| `clean` | Conservatively clean worktrees | `amiral clean --completed --dry-run` |
| `doctor` | Read-only diagnostics; optional safe fixes | `amiral doctor --json` |
| `config` | `path`, redacted `show`, or `validate` | `amiral config show --json` |

Use `plan --plan-file file.json` for an offline planner result. `init`, planning, status, doctor, and configuration support JSON automation. Destructive cancel/cleanup operations require confirmation in a TTY or the documented `--force` switch.

## `amiral run`

Exactly one selection mode may be used:

1. `amiral run "goal" [--type feature|bugfix|refactor]` plans, creates, and runs.
2. `amiral run --plan <plan-id-or-file>` creates from an existing plan and runs.
3. `amiral run --workflow <workflow-id>` resumes that workflow.
4. `amiral run` resumes the active workflow. `--plan-file` is the offline variant of mode 1.

The lifecycle is plan → validate DAG → create persistent state → schedule ready tasks → provider dispatch → integration → review → review fixes (bounded) → QA → completion. The engine stops cleanly with one of: `completed`, `failed`, `blocked`, `retry_scheduled`, `needs_input`, `max_review_rounds`, `no_progress`, or `interrupted`. Retry waits are persisted timestamps, not sleeps; rerun after the due time. State and task worktrees make all stop reasons recoverable or inspectable.

## Root discovery and module loading

Commands search upward from the current directory, preferring the nearest `team.yaml` and accepting `.amiral`/`.opencode` as a fallback project marker. Therefore commands work in nested directories and paths containing spaces. After discovery the CLI changes to the project root before dynamically importing legacy/domain modules: those modules intentionally resolve runtime paths from `process.cwd()`, while delayed imports prevent them from capturing the caller's nested directory.

## Locking and interruption

Mutating orchestration commands cooperate through `.amiral/amiral.lock`:

```json
{ "pid": 1234, "started_at": "2026-08-21T10:00:00.000Z", "command": "run" }
```

PID signal-0 determines liveness (`EPERM` means alive). A live holder blocks with exit 4; a dead or corrupt lock is replaced while holding the short-lived `.amiral/amiral.lock.guard` acquisition mutex. The mutex uses `proper-lockfile` with a 2-second stale timeout, 1-second heartbeat, and four bounded backoff retries (50–200ms), so a crashed acquisition owner recovers automatically. The public lock is removed only when its PID and ownership token still match. Read-only operations such as help, status views, configuration display, and normal doctor checks do not lock; mutations, including `doctor --fix`, do.

The first SIGINT/SIGTERM asks the run loop to stop before its next mutation, preserve state, and release the lock. The result is `interrupted`/exit 130. A second signal requests prompt termination. Child-provider interruption is best effort on Windows, so inspect status and rerun safely after interruption.

## Exit codes and output contract

| Code | Meaning |
| ---: | --- |
| 0 | success |
| 1 | unexpected/general failure |
| 2 | command usage error |
| 3 | missing/invalid project configuration |
| 4 | blocked workflow, quality decision, or live lock |
| 5 | provider failure |
| 6 | data/schema validation failure |
| 130 | interrupted |

Human output goes to stdout; errors and diagnostics go to stderr. `--json` emits one JSON document on successful stdout. Failures keep stdout empty and emit one error object on stderr. `--quiet` suppresses normal human output; `--verbose` adds progress and stack diagnostics where available. Expected failures do not print stacks by default. `NO_COLOR` is honored; tables and symbols do not depend on ANSI color for meaning.

```powershell
$status = amiral status --json | ConvertFrom-Json
amiral config show --json > normalized-config.json
amiral doctor --json > doctor.json
```

## Initialization and platform safety

`init` never runs `git init`. Existing files are preserved unless `--force`; `--minimal` installs only `team.yaml`, schemas, and workflows. `.gitignore` is updated only inside one marker-guarded Amiral block and user lines are retained. Runtime state, plans, integration worktrees, and locks are ignored.

Paths are passed as argument arrays rather than shell strings, resolved with Node path APIs, and tested with spaces. Child processes use cross-platform spawning. Cleanup is conservative and Windows file removal is best effort/retryable. Dynamic imports and root-first `chdir` keep nested invocation deterministic.

## Compatibility, verification, and limitations

Legacy commands such as `node --import tsx scripts/plan-workflow.ts analyze ...` and `scripts/workflow-state.ts list` remain available for automation and internal wrappers. Existing task graphs, state files, provider configuration fallbacks, and Phase 12/13 contracts remain supported.

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
node dist/src/cli/index.js --help
node dist/src/cli/index.js --version
node --import tsx scripts/plan-workflow.ts analyze examples/planner-result.example.json
git diff --check
```

There is no dashboard, remote/distributed or multi-user coordinator, plugin marketplace, token/cost accounting, or automatic PR creation. OpenCode is currently the only built-in provider. Conflict-domain scheduling remains conservative, and provider child-process interruption is best effort on Windows.
