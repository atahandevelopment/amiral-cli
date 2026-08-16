# OpenCode AI Team

A role-based, dependency-aware multi-agent software development team for [OpenCode](https://opencode.ai/).

This repository defines a reusable AI engineering workflow in which a **Lead Agent** coordinates specialized agents for planning, frontend, backend, database, DevOps, code review, and QA.

The goal is to make AI-assisted software development behave more like a structured engineering team than a single coding assistant.

---

## Overview

The system is built around a simple idea:

```text
User
  ↓
Lead
  ↓
Planner
  ↓
Task Graph
  ↓
┌────────────┬────────────┬────────────┐
│ Frontend   │ Backend    │ Database   │
└────────────┴────────────┴────────────┘
              ↓
          Integration
              ↓
           Reviewer
              ↓
              QA
              ↓
           Complete
```

The **Lead Agent** is the only orchestration authority. It understands the request, inspects the repository, selects the correct workflow, delegates work, enforces dependencies, validates agent results, coordinates review, runs QA, and reports completion only when all required quality gates have passed.

---

## Core Principles

The team follows several important engineering principles:

- Inspect the existing repository before making architectural or implementation decisions.
- Never assume a technology, pattern, or architecture exists without verifying it.
- Prefer existing project conventions over introducing unnecessary new patterns.
- Keep responsibilities separated between planning, implementation, review, and validation.
- Do not execute dependent tasks before their dependencies are complete.
- Run independent tasks in parallel only when it is safe.
- Preserve unrelated user changes.
- Never expose secrets or hard-code credentials.
- Never perform destructive Git operations without explicit approval.
- Never report non-trivial work as complete before implementation, review, and QA succeed.

For non-trivial work, the completion gate is:

```text
Implementation
      ↓
 Integration
      ↓
 Review PASS
      ↓
   QA PASS
      ↓
  Complete
```

---

## Repository Structure

```text
opencode-ai-team/
│
├── AGENTS.md
├── team.yaml
│
├── .opencode/
│   ├── agents/
│   │   ├── lead.md
│   │   ├── planner.md
│   │   ├── frontend.md
│   │   ├── backend.md
│   │   ├── database.md
│   │   ├── devops.md
│   │   ├── reviewer.md
│   │   └── qa.md
│   │
│   ├── workflows/
│   │   ├── feature.md
│   │   ├── bugfix.md
│   │   ├── refactor.md
│   │   ├── code-review.md
│   │   └── release.md
│   │
│   ├── orchestration/
│   │   ├── execution.md
│   │   ├── dependency.md
│   │   └── error-handling.md
│   │
│   ├── contracts/
│   │   ├── task.md
│   │   ├── agent-result.md
│   │   └── review-result.md
│   │
│   ├── policies/
│   │   ├── architecture.md
│   │   ├── git.md
│   │   ├── review.md
│   │   └── testing.md
│   │
│   └── opencode.json
│
├── memory/
│   ├── architecture.md
│   ├── conventions.md
│   ├── decisions.md
│   └── lessons-learned.md
│
├── scripts/
│   ├── start-team.ts
│   ├── assign-task.ts
│   ├── run-workflow.ts
│   └── validate-team.ts
│
└── vendor/
    └── addy-agent-skills
```

---

## Team Roles

### Lead

The Lead is the primary agent and orchestrator.

Responsibilities:

- Understand user requirements
- Inspect the repository
- Classify the requested work
- Select the appropriate workflow
- Delegate planning and implementation
- Coordinate task dependencies
- Validate agent results
- Coordinate code review
- Coordinate QA
- Decide when the work is actually complete

The Lead may implement directly only when the task is trivial, isolated, and low risk.

For non-trivial work, the Lead delegates to specialist agents.

---

### Planner

The Planner is responsible for turning a requirement into an executable engineering plan.

Responsibilities:

- Requirement analysis
- Repository analysis
- Architecture analysis
- Dependency analysis
- Task decomposition
- Skill discovery
- Acceptance criteria
- Risk identification

The Planner is intentionally restricted from modifying source code and from orchestrating other agents.

Its primary output is a **Task Graph**.

---

### Frontend

The Frontend Agent handles client-side implementation.

Primary technologies include:

- Next.js
- React
- Angular
- Astro
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query

Key rules:

- Use TypeScript strictly
- Prefer simple, maintainable components
- Avoid unnecessary abstractions
- Keep business logic outside presentation components
- Follow existing project conventions
- Handle loading, error, and empty states
- Run relevant tests, type checks, and linting

---

### Backend

The Backend Agent handles server-side implementation.

Primary technologies include:

- .NET
- ASP.NET Core
- Entity Framework Core
- REST APIs
- Scalar API Documentation

Responsibilities include:

- API implementation
- Business logic
- Validation
- Authentication and authorization
- Error handling
- Persistence integration

Key rules:

- Keep controllers thin
- Keep business logic out of controllers
- Validate inputs
- Prefer async APIs
- Follow the existing architecture
- Handle errors consistently
- Never expose sensitive data

---

### Database

The Database Agent is responsible for persistence-related work.

Typical responsibilities:

- Schemas
- Migrations
- Entities
- Relationships
- Indexes
- Queries
- PostgreSQL
- Database optimization

Database tasks can be used as dependencies for backend or other implementation work.

---

### DevOps

The DevOps Agent handles infrastructure, deployment, and operational concerns.

Typical areas include:

- Docker
- Kubernetes
- CI/CD
- Cloud infrastructure
- Deployment
- Environment configuration
- Operational reliability

> Note: DevOps exists in the agent definitions, Lead configuration, Planner rules, and task contract. The top-level `AGENTS.md` team list should be updated to include DevOps for consistency.

---

### Reviewer

The Reviewer is a dedicated quality gate and does not implement feature code.

It reviews:

1. Correctness
2. Architecture
3. Maintainability
4. Security
5. Performance
6. Error handling
7. Testing
8. Duplication
9. Unnecessary complexity

Findings are classified as:

```text
CRITICAL
HIGH
MEDIUM
LOW
SUGGESTION
```

A change cannot be approved while unresolved `CRITICAL` or `HIGH` issues remain.

Review results are expected to be:

```text
PASS
CHANGES_REQUESTED
BLOCKED
```

---

### QA

The QA Agent verifies that the implementation actually works.

QA may validate:

- Unit tests
- Integration tests
- End-to-end tests
- Type checking
- Linting
- Build
- Regression behavior

QA returns:

```text
PASS
```

or:

```text
FAIL
```

A failed QA result must include enough information to identify the failing area and reproduce the problem when possible.

---

## Workflows

The Lead selects one primary workflow based on the request.

### Feature

Used for:

- New functionality
- New modules
- New APIs
- New UI
- Authentication
- Database-backed features

File:

```text
.opencode/workflows/feature.md
```

Typical lifecycle:

```text
Requirement Analysis
        ↓
     Planning
        ↓
    Task Graph
        ↓
 Task Scheduling
        ↓
 Implementation
        ↓
   Integration
        ↓
  Code Review
        ↓
 Review Fixes
        ↓
       QA
        ↓
   QA Fixes
        ↓
   Completion
```

---

### Bug Fix

Used for:

- Existing bugs
- Unexpected behavior
- Failing tests
- Production issues
- Debugging existing functionality

File:

```text
.opencode/workflows/bugfix.md
```

Conceptually:

```text
Reproduce
   ↓
Root Cause
   ↓
Minimal Fix
   ↓
Review
   ↓
QA
```

---

### Refactor

Used for:

- Removing duplication
- Simplifying implementation
- Improving architecture
- Improving maintainability
- Restructuring code without intentionally changing behavior

File:

```text
.opencode/workflows/refactor.md
```

The key principle is to preserve existing behavior unless the task explicitly requests otherwise.

---

## Task Graph

For non-trivial and complex work, the Planner creates a Task Graph.

Each task must contain:

```yaml
id:
title:
agent:
description:
dependencies:
acceptance_criteria:
```

Example:

```yaml
tasks:

  - id: DB-001
    title: Create authentication schema
    agent: database
    description: Create the required database entities and relationships.
    dependencies: []
    acceptance_criteria:
      - Required entities exist
      - Relationships are correct
      - Migration succeeds

  - id: API-001
    title: Implement authentication API
    agent: backend
    description: Implement authentication endpoints and business logic.
    dependencies:
      - DB-001
    acceptance_criteria:
      - Login works
      - Registration works
      - Invalid credentials are rejected

  - id: UI-001
    title: Implement authentication interface
    agent: frontend
    description: Implement login and registration interfaces.
    dependencies:
      - API-001
    acceptance_criteria:
      - Login form works
      - Validation works
      - API errors are displayed correctly

  - id: REVIEW-001
    title: Review implementation
    agent: reviewer
    description: Review all implementation changes.
    dependencies:
      - API-001
      - UI-001
    acceptance_criteria:
      - No critical issues
      - Architecture is acceptable
      - Security concerns are resolved

  - id: QA-001
    title: Validate feature
    agent: qa
    description: Execute automated and functional validation.
    dependencies:
      - REVIEW-001
    acceptance_criteria:
      - Tests pass
      - Build passes
      - No blocking regressions
```

---

## Task Lifecycle

Valid task states are:

```text
pending
in_progress
completed
failed
blocked
cancelled
```

A task is considered **READY** when:

```text
status == pending
```

and all of its dependencies are:

```text
completed
```

Example:

```text
DB-001      completed
API-001     pending
UI-001      pending
```

If `API-001` depends on `DB-001`, then `API-001` becomes READY.

If `UI-001` does not depend on either task, it may also run in parallel.

---

## Dependency-Aware Execution

The Lead executes tasks according to dependency relationships.

Example:

```text
DB-001
   │
   ▼
API-001
   │
   ├──────────────┐
   ▼              ▼
UI-001         API-002
   │              │
   └──────┬───────┘
          ▼
       REVIEW
          │
          ▼
          QA
```

The Lead must not start a dependent task while any dependency is:

- pending
- in progress
- failed
- blocked

Independent tasks may run concurrently when safe.

Parallel execution should be avoided when tasks:

- Modify conflicting files
- Require sequential state
- Depend on each other
- Contain conflicting database migrations
- Share unsafe mutable resources

---

## Complexity Classification

The Lead classifies work into four categories.

### Trivial

Examples:

- Typo
- Small documentation change
- Small configuration change
- Isolated constant change

The Lead may implement directly.

### Simple

A small change affecting one area.

The Lead may delegate directly to a specialist without requiring a Planner.

### Non-Trivial

Typical characteristics:

- Multiple files
- Dependencies
- Architecture decisions
- Cross-module behavior

Planner required.

### Complex

Typical characteristics:

- Multiple agents
- Significant architectural work
- Database/API/frontend coordination
- Infrastructure changes
- High implementation risk

Planner required.

---

## Orchestration Lifecycle

The central execution protocol is defined in:

```text
.opencode/orchestration/execution.md
```

Lifecycle:

```text
REQUEST
   ↓
CLASSIFY
   ↓
WORKFLOW
   ↓
PLAN
   ↓
TASK GRAPH
   ↓
EXECUTE
   ↓
COLLECT RESULTS
   ↓
REVIEW
   ↓
QA
   ↓
COMPLETE
```

The Lead repeatedly performs:

```text
PLAN
  ↓
VALIDATE GRAPH
  ↓
FIND READY TASKS
  ↓
EXECUTE
  ↓
COLLECT RESULTS
  ↓
UPDATE GRAPH
  ↓
FIND READY TASKS
  ↓
REPEAT
```

until the workflow is complete or blocked.

---

## Review Feedback Loop

If the Reviewer returns:

```text
CHANGES_REQUESTED
```

the Lead must identify the responsible implementation agent and delegate the required correction.

```text
Reviewer
   ↓
CHANGES_REQUESTED
   ↓
Lead
   ↓
Responsible Agent
   ↓
Fix
   ↓
Reviewer
```

QA must not begin while blocking review findings remain.

---

## QA Feedback Loop

If QA returns:

```text
FAIL
```

the Lead must identify the responsible implementation task and delegate the fix.

If implementation changed, review should run again before QA is repeated.

```text
QA FAIL
   ↓
Lead
   ↓
Responsible Agent
   ↓
Fix
   ↓
Reviewer
   ↓
QA
```

The workflow must never report success while blocking QA failures remain.

---

## Contracts

The repository defines explicit communication contracts under:

```text
.opencode/contracts/
```

### Task Contract

Defines the structure of Planner-generated engineering tasks.

Required fields:

- `id`
- `title`
- `agent`
- `description`
- `dependencies`
- `acceptance_criteria`

Optional fields include:

- `priority`
- `parallel`
- `estimated_complexity`
- `skills`
- `files`

---

### Agent Result Contract

Defines how implementation agents report task results back to the Lead.

This allows the Lead to map agent execution outcomes into workflow state.

Conceptually:

```text
Agent Result
     │
     ├── completed → task = completed
     ├── failed    → task = failed
     └── blocked   → task = blocked
```

---

### Review Result Contract

Defines the expected format for review output and makes review results easier for the Lead to process consistently.

---

## Policies

Policies define engineering rules that apply across roles.

Available policies include:

```text
.opencode/policies/architecture.md
.opencode/policies/git.md
.opencode/policies/review.md
.opencode/policies/testing.md
```

The architecture can be understood as:

```text
Agent
= responsibility

Workflow
= process

Policy
= rules

Skill
= specialized knowledge

Contract
= communication format
```

Keeping these concerns separate makes the system easier to maintain and extend.

---

## Skills

`team.yaml` associates agents with relevant skill areas.

Frontend skills include areas such as:

- Next.js
- React
- TypeScript
- Tailwind
- Storybook
- TanStack Query
- Axios
- Angular
- Vue
- NextAuth
- Material UI
- Ant Design

Backend skills include:

- .NET
- EF Core
- REST
- gRPC
- GraphQL
- Redis
- Kafka
- RabbitMQ
- Docker
- Kubernetes
- AWS
- Azure
- Elasticsearch

Database skills include:

- PostgreSQL
- Optimization

QA skills include:

- Unit testing
- Integration testing
- E2E testing

Agents are instructed to load only relevant skills using OpenCode's native skill mechanism.

This avoids unnecessarily loading every available specialization into every task.

---

## Memory

The `memory/` directory stores reusable project knowledge.

```text
memory/
├── architecture.md
├── conventions.md
├── decisions.md
└── lessons-learned.md
```

### `architecture.md`

Documents the project's current architecture.

### `conventions.md`

Stores project conventions and recurring implementation patterns.

### `decisions.md`

Stores important technical decisions and their rationale.

Examples:

- Why PostgreSQL was chosen
- Why REST was chosen instead of GraphQL
- Why a specific state-management solution was selected

### `lessons-learned.md`

Stores useful knowledge from previous implementation problems, mistakes, or recurring issues.

The memory layer is intended to reduce repeated discovery and preserve engineering context across tasks.

---

## Configuration

The current OpenCode configuration is intentionally minimal:

```json
{
  "$schema": "https://opencode.ai/config.json"
}
```

Most of the team behavior is currently defined by agent instructions and workflow files under `.opencode/`.

---

## How It Works in Practice

Suppose the user requests:

```text
Add a favorites feature for products.
```

The expected execution is:

```text
User
 ↓
Lead
 ↓
Feature Workflow
 ↓
Planner
 ↓
Task Graph
```

The Planner might produce:

```yaml
tasks:

  - id: DB-001
    agent: database
    dependencies: []

  - id: API-001
    agent: backend
    dependencies:
      - DB-001

  - id: UI-001
    agent: frontend
    dependencies:
      - API-001

  - id: REVIEW-001
    agent: reviewer
    dependencies:
      - API-001
      - UI-001

  - id: QA-001
    agent: qa
    dependencies:
      - REVIEW-001
```

The Lead then executes the graph:

```text
DB-001
   ↓
API-001
   ↓
UI-001
   ↓
Reviewer
   ↓
QA
```

If the Reviewer finds a blocking problem:

```text
Reviewer
   ↓
Backend / Frontend Fix
   ↓
Reviewer
```

If QA fails:

```text
QA
 ↓
Responsible Agent Fix
 ↓
Reviewer
 ↓
QA
```

The Lead reports completion only after:

```text
Review = PASS
QA = PASS
```

---

## Current Limitations

This repository currently provides a strong **agent specification and orchestration protocol**, but it is not yet a standalone orchestration runtime.

### Empty Runtime Scripts

The following files currently exist but are empty:

```text
scripts/start-team.ts
scripts/assign-task.ts
scripts/run-workflow.ts
scripts/validate-team.ts
```

As a result, there is currently no separate TypeScript runtime that executes the task graph outside OpenCode's native agent/task capabilities.

---

### Empty Workflow Files

The following workflow files currently exist but are empty:

```text
.opencode/workflows/code-review.md
.opencode/workflows/release.md
```

The active workflow definitions are currently:

- Feature
- Bug Fix
- Refactor

---

### Task State Is Conceptual

Task state is currently maintained conceptually by the Lead during the active agent session.

There is no persistent runtime state such as:

```text
tasks.json
workflow-state.json
SQLite
```

This could become important for very long-running workflows or workflows that need to recover after a session interruption.

---

### `team.yaml` Is Declarative Metadata

`team.yaml` defines team roles, skills, and workflow file mappings, but there is currently no executable runtime that parses it and dynamically builds a scheduler from the configuration.

---

## Suggested Runtime Evolution

A future version could introduce a persistent execution layer:

```text
User
 ↓
Lead
 ↓
Planner
 ↓
tasks.json
 ↓
Task Scheduler
 ↓
┌───────────┬────────────┬──────────┐
│ Frontend  │ Backend    │ Database │
└───────────┴────────────┴──────────┘
             ↓
       Agent Results
             ↓
        State Manager
             ↓
          Reviewer
             ↓
             QA
             ↓
      Workflow Result
```

For example:

```text
.opencode/runtime/
├── tasks.json
├── state.json
└── history.json
```

A possible workflow state:

```json
{
  "workflow": "feature",
  "status": "running",
  "tasks": {
    "DB-001": "completed",
    "API-001": "in_progress",
    "UI-001": "pending"
  }
}
```

This would allow workflows to resume after interrupted sessions and make execution state explicit.

---

## Strengths of the Architecture

The current design has several strong properties.

### Lead-Only Orchestration

Only one agent is responsible for coordination, reducing nested-agent chaos and conflicting decisions.

### Planning Is Separated From Implementation

The Planner cannot edit source code, helping keep architecture analysis independent from implementation.

### Review Is Independent

The Reviewer is not supposed to fix the implementation it reviews.

### Explicit Dependency Graph

Tasks are scheduled according to dependencies instead of being executed in arbitrary order.

### Strong Completion Gate

A developer saying "done" does not mean the workflow is complete.

The required lifecycle is:

```text
Implementation
+
Integration
+
Review
+
QA
```

### Lazy Skill Loading

Skills can be loaded only when relevant, reducing unnecessary context and token usage.

### Existing Architecture First

Agents are repeatedly instructed to inspect and follow the current repository rather than inventing a new architecture.

---

## Design Summary

The repository can be described as:

> A dependency-aware, role-based multi-agent software development team specification for OpenCode with planning, specialized implementation, review, QA, policy enforcement, and structured task contracts.

It is currently best viewed as an **AI engineering team specification and workflow layer**, rather than a standalone orchestration framework.

Its intended architecture is:

```text
                 USER
                   │
                   ▼
                 LEAD
                   │
           ┌───────┴───────┐
           ▼               ▼
        Workflow         Planner
                           │
                           ▼
                      Task Graph
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Frontend      Backend      Database
              │            │            │
              └────────────┼────────────┘
                           ▼
                      Integration
                           │
                           ▼
                        Reviewer
                           │
                   ┌───────┴────────┐
                   │                │
                 PASS       CHANGES_REQUESTED
                   │                │
                   ▼                └──→ Developer
                  QA
                   │
              ┌────┴────┐
            PASS       FAIL
              │          │
              ▼          └──→ Developer
           COMPLETE
```

---

## Roadmap Ideas

Potential future improvements:

- Implement `start-team.ts`
- Implement `assign-task.ts`
- Implement `run-workflow.ts`
- Implement `validate-team.ts`
- Add persistent workflow state
- Add automatic task graph validation
- Add cycle detection for dependencies
- Add concurrency limits
- Add agent execution history
- Add token/cost tracking
- Complete the code review workflow
- Complete the release workflow
- Add CI validation for agent definitions
- Add JSON Schema validation for task contracts
- Add resumable workflows
- Add task retry policies
- Add structured telemetry
- Add example projects
- Add OpenCode installation/setup automation

---

## License

No license has been defined yet.

If this project is intended for public reuse, consider adding a license such as MIT, Apache-2.0, or another license appropriate for the project.
