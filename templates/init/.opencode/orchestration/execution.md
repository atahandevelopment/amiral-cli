````markdown
# Agent Execution Protocol

This document defines how the Lead Agent executes a Planner-generated task graph.

The Lead is the only orchestration authority.

Other agents must not orchestrate other agents.

---

# Execution Lifecycle

Every non-trivial task follows this lifecycle:

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
````

---

# Step 1 — Receive Request

The Lead receives the user's request.

The Lead determines:

* task type
* scope
* complexity
* affected areas
* required workflow

---

# Step 2 — Select Workflow

Select exactly one primary workflow:

```text
feature
bugfix
refactor
```

Read the corresponding workflow before planning.

---

# Step 3 — Determine Complexity

The Lead determines whether the task is:

```text
trivial
simple
non-trivial
complex
```

## Trivial

Examples:

* typo
* simple documentation change
* simple configuration value
* isolated constant change

The Lead may implement directly.

## Simple

A small change affecting one area.

The Lead may delegate directly to one specialist without Planner when appropriate.

## Non-trivial

Multiple files, dependencies or architectural decisions.

Planner is required.

## Complex

Multiple agents, architectural changes, database/API/frontend coordination or significant risk.

Planner is required.

---

# Step 4 — Planning

For non-trivial and complex tasks:

Delegate to:

`planner`

The Planner returns a Task Graph using:

`.opencode/contracts/task.md`

The Lead must inspect the generated task graph before executing it.

---

# Step 5 — Validate Task Graph

Before execution, verify:

* every task has an ID
* every task has an assigned agent
* dependencies exist
* no circular dependencies exist
* acceptance criteria exist
* agents are valid
* tasks have reasonable scope

If the graph is invalid, return it to the Planner for correction.

Do not execute an invalid graph.

---

# Step 6 — Initialize Task State

Each task starts as:

```text
pending
```

The Lead maintains the conceptual state:

```text
pending
in_progress
completed
failed
blocked
cancelled
```

---

# Step 7 — Find Ready Tasks

A task is READY when:

```text
status == pending
```

and:

```text
all dependencies == completed
```

Example:

```text
DB-001      completed
API-001     completed
UI-001      pending
REVIEW-001  pending
```

If REVIEW-001 depends on DB-001 and API-001:

```text
REVIEW-001 = READY
```

---

# Step 8 — Execute Ready Tasks

The Lead delegates READY tasks to their assigned agents.

Example:

```text
DB-001 → database
API-001 → backend
UI-001 → frontend
```

Independent READY tasks may be executed in parallel when safe.

Do not serialize independent work unnecessarily.

---

# Step 9 — Collect Results

Every agent must return an Agent Result according to:

`.opencode/contracts/agent-result.md`

The Lead updates task state according to the result.

---

# Result Mapping

```text
agent result
     │
     ├── completed → task = completed
     │
     ├── failed    → task = failed
     │
     └── blocked   → task = blocked
```

---

# Step 10 — Update Task Graph

After every completed task:

1. Update task state.
2. Check dependent tasks.
3. Find newly READY tasks.
4. Execute them.

Example:

```text
Before:

DB-001      completed
API-001     pending
UI-001      pending

After DB-001:

DB-001      completed
API-001     READY
UI-001      READY
```

The Lead may now delegate API-001 and UI-001.

---

# Step 11 — Failure Handling

If a task fails:

Do not automatically continue dependent tasks.

Example:

```text
DB-001 = failed

API-001 depends on DB-001
```

Therefore:

```text
API-001 = blocked
```

The Lead must determine whether:

1. the task should be retried
2. the task should be fixed
3. the plan should be changed
4. the user must be consulted

---

# Step 12 — Review Gate

Implementation is not considered complete until review succeeds.

After all implementation tasks complete:

Delegate to:

`reviewer`

The Reviewer returns:

```text
PASS
CHANGES_REQUESTED
BLOCKED
```

---

# Step 13 — Review Result

## PASS

Continue to QA.

```text
IMPLEMENTATION
      ↓
   REVIEW
      ↓
     PASS
      ↓
      QA
```

## CHANGES_REQUESTED

Identify responsible agent.

Delegate correction.

Then review again.

```text
IMPLEMENTATION
      ↓
   REVIEW
      ↓
CHANGES_REQUESTED
      ↓
    FIX
      ↓
   REVIEW
```

## BLOCKED

Stop the workflow.

The Lead must determine how to resolve the blocking issue.

---

# Step 14 — QA Gate

After review passes:

Delegate to:

`qa`

QA returns:

```text
PASS
FAIL
```

---

# Step 15 — QA Failure

If QA fails:

1. Identify failing area.
2. Identify responsible agent.
3. Delegate correction.
4. Re-run review if implementation changed.
5. Re-run QA.

Never report success while blocking QA failures remain.

---

# Step 16 — Completion

The workflow is complete when:

```text
all implementation tasks = completed
review = PASS
qa = PASS
```

The Lead then produces the final result for the user.

---

# Execution Rules

The Lead must:

* respect dependencies
* avoid unnecessary serialization
* avoid duplicate work
* preserve user changes
* keep task scope controlled
* validate agent results
* never claim success without validation

---

# Stop Conditions

Stop execution when:

* critical security issue is discovered
* destructive action requires approval
* task graph becomes invalid
* architecture requires an unresolved decision
* required external information is unavailable
* agent results contradict each other

In these cases, the Lead must explain the blocker.

```
```
