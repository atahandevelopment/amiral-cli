````markdown
# Agent Error Handling Protocol

This document defines how the Lead handles failures, blockers and unexpected agent behavior.

---

# Error Categories

Errors are classified as:

```text
IMPLEMENTATION_ERROR
TEST_FAILURE
REVIEW_FAILURE
ARCHITECTURE_BLOCKER
DEPENDENCY_FAILURE
TOOL_FAILURE
AGENT_FAILURE
SECURITY_ISSUE
USER_DECISION_REQUIRED
````

---

# Implementation Error

An implementation agent reports:

```yaml
status: failed
```

The Lead must:

1. Inspect the failure.
2. Determine whether the task can be retried.
3. Determine whether the task description is incorrect.
4. Determine whether another agent is required.

Do not blindly retry indefinitely.

---

# Retry Policy

A failed task may be retried when:

* the failure is transient
* a tool failed
* a missing dependency was resolved
* the agent made an obvious recoverable mistake

Do not repeatedly retry deterministic failures.

After repeated failure, escalate to the Lead's reasoning or Planner.

---

# Test Failure

If tests fail:

1. Identify the failing test.
2. Determine whether the implementation caused the failure.
3. Delegate correction.
4. Re-run validation.

Never remove or weaken a test merely to obtain a passing result.

---

# Review Failure

If Reviewer returns:

```text
CHANGES_REQUESTED
```

the Lead must delegate the required changes.

If Reviewer returns:

```text
BLOCKED
```

the Lead must resolve the blocker before continuing.

---

# Architecture Blocker

If an agent discovers that implementation requires an unresolved architectural decision:

Stop the affected task.

Do not invent an architecture without sufficient evidence.

Possible actions:

* ask Planner for analysis
* inspect existing architecture
* ask another specialist for input
* ask the user for a decision

---

# Dependency Failure

If a dependency fails:

```text
dependent tasks must not execute
```

The Lead should attempt to resolve the failed dependency first.

---

# Tool Failure

Examples:

* unavailable tool
* command failure
* network failure
* package manager failure
* environment failure

The agent should report:

* command attempted
* error
* affected task
* whether retry is safe

---

# Agent Failure

If an agent cannot complete its task:

```yaml
status: failed
```

The Lead determines whether to:

1. retry
2. modify the task
3. assign another appropriate agent
4. ask the Planner for a revised plan

---

# Security Issue

Security issues are always high priority.

Examples:

* exposed secret
* authentication bypass
* authorization flaw
* unsafe SQL
* command injection
* sensitive data exposure
* insecure dependency

Stop affected execution when necessary.

Do not suppress or ignore security findings.

---

# User Decision Required

Some decisions cannot safely be inferred.

Examples:

* destructive database migration
* breaking API change
* replacing an existing architecture
* deleting user data
* changing product behavior
* introducing significant infrastructure cost

Stop and ask the user when their explicit decision is required.

---

# Contradictory Agent Results

If agents provide contradictory information:

1. Do not assume either result is correct.
2. Inspect the repository.
3. Compare evidence.
4. Ask a specialist for clarification.
5. Escalate to the user when necessary.

---

# Infinite Loop Prevention

Never repeatedly execute:

```text
fix
→ review
→ fix
→ review
```

without progress.

If the same issue persists after reasonable attempts:

Stop and report the blocker.

---

# Final Error Reporting

When the workflow cannot complete, the Lead must report:

* failed task
* error category
* root cause when known
* actions attempted
* current state
* required next action

```
```
