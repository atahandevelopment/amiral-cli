````markdown
# Task Dependency Protocol

This document defines dependency handling for the AI agent team.

---

# Dependency Principle

A task can execute only when all of its dependencies are successfully completed.

```text
A
│
▼
B
│
▼
C
````

B cannot start until A completes.

C cannot start until B completes.

---

# Dependency States

A task may have:

```text
NO_DEPENDENCY
WAITING
READY
IN_PROGRESS
COMPLETED
FAILED
BLOCKED
```

---

# Ready Condition

A task is READY when:

```text
task.status == pending
```

and:

```text
every dependency.status == completed
```

---

# Independent Tasks

Tasks with no dependency relationship may run in parallel.

Example:

```text
DB-001 ──────┐
             │
API-001 ─────┼──► REVIEW
             │
UI-001 ──────┘
```

DB-001, API-001 and UI-001 may execute concurrently if their actual implementation does not conflict.

---

# Dependency Chain

Example:

```text
DB-001
   ↓
API-001
   ↓
UI-001
```

Execution order:

```text
DB-001
   ↓
API-001
   ↓
UI-001
```

---

# Multiple Dependencies

Example:

```text
DB-001 ──────┐
             ├──► API-001
AUTH-001 ────┘
```

API-001 must wait for both:

```text
DB-001 = completed
AUTH-001 = completed
```

---

# Failed Dependency

If:

```text
DB-001 = failed
```

and:

```text
API-001 depends on DB-001
```

then API-001 cannot execute.

Its effective state becomes:

```text
blocked
```

---

# Blocked Dependency

A blocked dependency propagates blocking status to dependent tasks.

Example:

```text
A = blocked

B depends on A
C depends on B
```

Result:

```text
A = blocked
B = blocked
C = blocked
```

The Lead may override this only by changing the task graph.

---

# Circular Dependencies

Circular dependencies are invalid.

Invalid:

```text
A → B
B → C
C → A
```

The Lead must not execute this graph.

Return the graph to the Planner for correction.

---

# Dependency Validation

Before execution, verify:

1. Every dependency references an existing task.
2. No task depends on itself.
3. No circular dependency exists.
4. All dependencies have valid IDs.
5. The graph has at least one task with no dependencies.

---

# Dependency Updates

When a task becomes:

```text
completed
```

the Lead must immediately check all dependent tasks.

Newly satisfied tasks become READY.

---

# Parallel Execution Safety

Parallel execution is allowed only when:

* dependencies are satisfied
* tasks do not modify the same critical files
* tasks do not require sequential state
* database migrations do not conflict
* generated files do not conflict
* shared resources are safe to access concurrently

When uncertain, serialize the tasks.

Correctness is more important than speed.

```
```
