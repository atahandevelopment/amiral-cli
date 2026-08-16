````markdown
# Feature Development Workflow

This workflow defines how the AI development team handles a non-trivial feature request.

The Lead Agent is responsible for orchestration.

---

# Phase 1 — Requirement Analysis

Agent:

`lead`

Responsibilities:

1. Understand the user's requirement.
2. Identify the expected outcome.
3. Identify constraints.
4. Determine affected areas.
5. Inspect the repository.
6. Identify relevant skills.

The Lead must not start implementation during this phase.

---

# Phase 2 — Planning

Agent:

`planner`

The Lead delegates planning to the Planner.

The Planner must:

1. Inspect the repository.
2. Understand the existing architecture.
3. Identify affected components.
4. Identify relevant skills.
5. Decompose the feature into implementation tasks.
6. Identify dependencies.
7. Identify tasks that can run in parallel.
8. Define acceptance criteria.

The Planner must not modify source code.

---

# Phase 3 — Task Graph

The Planner must produce a task graph.

Each task must contain:

- id
- title
- agent
- description
- dependencies
- acceptance_criteria

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
````

The actual task graph must be based on the repository and feature.

Do not blindly copy this example.

---

# Phase 4 — Task Scheduling

The Lead executes tasks according to their dependencies.

## Independent Tasks

Tasks with no dependency relationship may run in parallel.

Example:

```text
DB-001
FRONTEND-001
```

can run simultaneously if they do not depend on each other.

## Dependent Tasks

A task must not start until all of its dependencies are complete.

Example:

```text
DB-001
   │
   ▼
API-001
   │
   ▼
UI-001
```

---

# Phase 5 — Implementation

Implementation agents:

* `database`
* `backend`
* `frontend`

Each implementation agent must:

1. Inspect the existing implementation.
2. Read relevant policies.
3. Discover relevant skills.
4. Implement only its assigned task.
5. Avoid unrelated modifications.
6. Run appropriate validation.
7. Report the result.

---

# Phase 6 — Integration

After implementation tasks are complete, the Lead must verify that dependent tasks are compatible.

Check:

* API contracts
* database relationships
* frontend/backend integration
* types
* validation
* error handling
* configuration

If integration problems are found, delegate them to the appropriate implementation agent.

---

# Phase 7 — Code Review

Agent:

`reviewer`

The Reviewer must inspect the implementation.

Review:

* correctness
* architecture
* maintainability
* security
* performance
* error handling
* tests
* project conventions

The Reviewer returns one of:

```text
PASS
CHANGES_REQUESTED
BLOCKED
```

---

# Phase 8 — Review Fixes

If the Reviewer returns:

`CHANGES_REQUESTED`

the Lead must:

1. Identify the responsible implementation agent.
2. Delegate the required fix.
3. Wait for the fix.
4. Request another review.

Do not proceed to QA while blocking review issues remain.

---

# Phase 9 — QA

Agent:

`qa`

QA validates the completed feature.

QA should run appropriate:

* unit tests
* integration tests
* end-to-end tests
* lint
* type checking
* build

QA returns:

```text
PASS
FAIL
```

---

# Phase 10 — QA Fixes

If QA returns:

`FAIL`

the Lead must:

1. Identify the failing task.
2. Determine the responsible implementation agent.
3. Delegate the fix.
4. Re-run QA.

Do not report completion while blocking QA failures remain.

---

# Phase 11 — Completion

The Lead may report the feature as complete only when:

* all implementation tasks are complete
* integration succeeds
* code review passes
* QA passes
* no critical issues remain

The final response should summarize:

* implemented functionality
* files changed
* agents involved
* tests executed
* review result
* QA result
* remaining known issues

```
```
