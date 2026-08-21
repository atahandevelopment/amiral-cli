````markdown
# Bug Fix Workflow

This workflow defines how the AI development team investigates and fixes software defects.

The Lead Agent is responsible for orchestration.

---

# Phase 1 — Bug Intake

Agent:

`lead`

The Lead must understand:

- reported behavior
- expected behavior
- affected functionality
- reproduction information
- environment
- severity
- user impact

If the bug report is incomplete, inspect the repository and available evidence before making assumptions.

---

# Phase 2 — Investigation

Agent:

`planner`

The Lead delegates investigation to the Planner.

The Planner must:

1. Inspect the relevant code.
2. Trace the affected execution path.
3. Identify related components.
4. Inspect existing tests.
5. Inspect logs or error messages when available.
6. Identify relevant skills.
7. Determine the most likely root cause.
8. Identify possible side effects.

The Planner must not modify source code.

---

# Phase 3 — Root Cause

The Planner must provide:

- reproduction steps
- expected behavior
- actual behavior
- affected files
- execution flow
- root cause
- contributing factors
- proposed fix
- regression risks

Do not implement a fix until the root cause is sufficiently understood.

---

# Phase 4 — Fix Plan

The Planner creates a task graph.

Example:

```yaml
tasks:

  - id: ROOT-001
    title: Confirm root cause
    agent: planner
    description: Confirm the identified root cause against the repository.
    dependencies: []
    acceptance_criteria:
      - Root cause is reproducible
      - Affected code path is identified

  - id: FIX-001
    title: Implement bug fix
    agent: backend
    description: Implement the minimal correction required to fix the defect.
    dependencies:
      - ROOT-001
    acceptance_criteria:
      - Original defect is fixed
      - Existing behavior remains intact

  - id: TEST-001
    title: Add regression test
    agent: qa
    description: Add or update tests covering the defect.
    dependencies:
      - FIX-001
    acceptance_criteria:
      - Regression scenario is covered
      - Test passes

  - id: REVIEW-001
    title: Review bug fix
    agent: reviewer
    description: Review the fix and regression coverage.
    dependencies:
      - FIX-001
      - TEST-001
    acceptance_criteria:
      - No blocking issues
````

The actual agent assigned to `FIX-001` must be determined by the affected part of the system.

Possible agents:

* `frontend`
* `backend`
* `database`

---

# Phase 5 — Implementation

The responsible implementation agent must:

1. Inspect the relevant code.
2. Read relevant policies.
3. Discover relevant skills.
4. Implement the smallest safe fix.
5. Avoid unrelated refactoring.
6. Preserve existing behavior outside the defect.
7. Run relevant tests.

---

# Phase 6 — Regression Testing

Agent:

`qa`

QA must verify:

* original bug is fixed
* regression test passes
* related functionality still works
* edge cases are handled
* existing tests remain successful

When appropriate, reproduce the original failure before and after the fix.

---

# Phase 7 — Code Review

Agent:

`reviewer`

Review specifically for:

* correctness
* root cause coverage
* unintended side effects
* security
* data integrity
* regression risks
* unnecessary changes

The Reviewer returns:

```text
PASS
CHANGES_REQUESTED
BLOCKED
```

---

# Phase 8 — Review Fixes

If the Reviewer returns:

`CHANGES_REQUESTED`

the Lead delegates the required corrections to the responsible implementation agent.

After corrections:

```text
implementation
      ↓
review
      ↓
PASS
```

must be achieved before completion.

---

# Phase 9 — Final QA

QA executes the complete relevant validation suite.

At minimum:

* regression test
* affected module tests
* relevant integration tests
* type checking
* linting
* build when appropriate

QA returns:

```text
PASS
FAIL
```

---

# Phase 10 — Completion

The Lead may report the bug as fixed only when:

* root cause is understood
* fix is implemented
* regression coverage exists when appropriate
* code review passes
* QA passes
* no critical regression remains

The final report must include:

* bug summary
* root cause
* fix
* files changed
* regression tests
* review result
* QA result
* remaining risks

```
```
