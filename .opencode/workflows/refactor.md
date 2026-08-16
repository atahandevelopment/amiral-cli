````markdown
# Refactoring Workflow

This workflow defines how the AI development team performs safe code refactoring.

The primary objective is to improve internal code quality without changing externally observable behavior unless explicitly requested.

The Lead Agent is responsible for orchestration.

---

# Phase 1 — Refactoring Request

Agent:

`lead`

The Lead must determine:

- what should be refactored
- why it should be refactored
- expected improvement
- affected functionality
- constraints
- acceptable scope

The Lead must distinguish between:

- structural refactoring
- performance refactoring
- architectural refactoring
- dependency refactoring
- code simplification

---

# Phase 2 — Baseline Analysis

Agent:

`planner`

The Planner must inspect:

- target code
- dependencies
- callers
- tests
- related modules
- configuration
- performance characteristics when relevant

The Planner must identify the current behavior before changes.

---

# Phase 3 — Behavior Baseline

Before modifying code, identify existing behavior that must remain unchanged.

Document:

- inputs
- outputs
- side effects
- error behavior
- API contracts
- database behavior
- UI behavior
- performance expectations when relevant

Existing tests should be identified as the primary behavior baseline.

If adequate tests do not exist, identify where regression coverage is required.

---

# Phase 4 — Refactoring Plan

The Planner creates a task graph.

Example:

```yaml
tasks:

  - id: BASE-001
    title: Establish behavior baseline
    agent: planner
    description: Identify current behavior and relevant tests.
    dependencies: []
    acceptance_criteria:
      - Existing behavior is documented
      - Relevant tests are identified

  - id: REFACTOR-001
    title: Perform refactoring
    agent: backend
    description: Refactor the target implementation without changing behavior.
    dependencies:
      - BASE-001
    acceptance_criteria:
      - Target code is improved
      - External behavior remains unchanged
      - No unrelated files are modified

  - id: TEST-001
    title: Validate behavior preservation
    agent: qa
    description: Verify that behavior remains unchanged after refactoring.
    dependencies:
      - REFACTOR-001
    acceptance_criteria:
      - Existing tests pass
      - Required regression tests pass
      - Build passes

  - id: REVIEW-001
    title: Review refactoring
    agent: reviewer
    description: Review structural quality and behavior preservation.
    dependencies:
      - REFACTOR-001
      - TEST-001
    acceptance_criteria:
      - Refactoring has clear value
      - No unnecessary complexity
      - No behavior regression
````

The actual implementation agent must be determined from the affected system.

Possible agents:

* `frontend`
* `backend`
* `database`

---

# Phase 5 — Implementation

The responsible implementation agent must:

1. Inspect the target code.
2. Read relevant policies.
3. Discover relevant skills.
4. Make focused changes.
5. Preserve external behavior.
6. Avoid unrelated improvements.
7. Run appropriate validation.

---

# Phase 6 — Behavior Validation

Agent:

`qa`

QA must compare behavior before and after refactoring.

Verify:

* functional behavior
* error behavior
* API contracts
* data behavior
* UI behavior
* performance when relevant

All relevant existing tests must pass.

---

# Phase 7 — Code Review

Agent:

`reviewer`

The Reviewer evaluates:

* readability
* maintainability
* architecture
* complexity
* duplication
* coupling
* performance
* security
* behavior preservation

The Reviewer must specifically verify that the refactoring provides a meaningful improvement.

Avoid approving refactoring that merely changes code style without providing value.

Verdict:

```text
PASS
CHANGES_REQUESTED
BLOCKED
```

---

# Phase 8 — Review Corrections

If review returns:

`CHANGES_REQUESTED`

the Lead delegates corrections to the responsible implementation agent.

The implementation is reviewed again after corrections.

---

# Phase 9 — Final QA

QA executes:

* unit tests
* integration tests
* end-to-end tests when relevant
* lint
* type checking
* build
* performance checks when relevant

QA returns:

```text
PASS
FAIL
```

---

# Phase 10 — Completion

The Lead may report the refactoring as complete only when:

* intended structural improvement is achieved
* externally observable behavior is preserved
* tests pass
* code review passes
* QA passes
* no unrelated changes remain

The final report must include:

* refactoring objective
* changes made
* behavior preserved
* files changed
* tests executed
* review result
* QA result
* remaining risks

```
```
