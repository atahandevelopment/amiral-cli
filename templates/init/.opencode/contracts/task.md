````markdown
# Task Contract

This contract defines the standard structure of an engineering task.

Every task created by the Planner must follow this structure.

---

## Required Fields

### id

Unique task identifier.

Examples:

- DB-001
- API-001
- UI-001
- REVIEW-001
- QA-001

---

### title

Short and descriptive task title.

---

### agent

The specialist responsible for the task.

Allowed values:

- planner
- frontend
- backend
- database
- devops
- reviewer
- qa

---

### description

Clear description of what must be implemented or investigated.

The description must be specific enough for the assigned agent to execute without guessing.

---

### dependencies

List of task IDs that must be completed before this task starts.

Example:

```yaml
dependencies:
  - DB-001
  - API-001
````

Use:

```yaml
dependencies: []
```

when there are no dependencies.

---

### acceptance_criteria

List of measurable conditions that define successful completion.

Example:

```yaml
acceptance_criteria:
  - Login endpoint returns HTTP 200 for valid credentials
  - Invalid credentials return HTTP 401
  - Authentication tests pass
```

---

## Optional Fields

### priority

Allowed values:

* critical
* high
* medium
* low

---

### parallel

Whether the task can execute in parallel with other independent tasks.

Example:

```yaml
parallel: true
```

---

### estimated_complexity

Allowed values:

* trivial
* low
* medium
* high
* critical

---

### skills

Relevant skills that the assigned agent should consider.

Example:

```yaml
skills:
  - security
  - api-design
  - testing
```

The agent should still use the native skill tool to load the actual skill instructions.

---

### files

Known files or directories likely to be affected.

Example:

```yaml
files:
  - src/api/auth/
  - tests/auth/
```

These are hints, not restrictions.

The agent must inspect the repository before making changes.

---

# Example

```yaml
id: API-001

title: Implement authentication API

agent: backend

description: >
  Implement login and registration endpoints using the existing
  authentication architecture.

dependencies:
  - DB-001

acceptance_criteria:
  - Login endpoint accepts valid credentials
  - Invalid credentials are rejected
  - Registration validates input
  - Authentication tests pass

priority: high

parallel: false

estimated_complexity: high

skills:
  - api-design
  - authentication
  - security

files:
  - src/api/auth/
  - tests/auth/
```

---

# Task Rules

The assigned agent must:

1. Read the complete task.
2. Inspect the repository.
3. Load relevant skills.
4. Read relevant policies.
5. Implement only the assigned task.
6. Validate the implementation.
7. Return an `agent-result` according to the Agent Result Contract.

Agents must not silently change the task scope.

If the task cannot be completed as specified, return:

```yaml
status: blocked
```

and explain why.

---

# Dependency Rules

A task must not start until all dependencies are completed successfully.

A dependency is considered completed only when its assigned agent returns:

```yaml
status: completed
```

If a dependency fails or becomes blocked, dependent tasks must wait for Lead instructions.

---

# Task Status

Valid task statuses:

```text
pending
in_progress
completed
failed
blocked
cancelled
```

---

# Scope Changes

If an agent discovers that additional work is required:

Do not silently expand the task.

Return:

```yaml
status: blocked
```

or:

```yaml
status: completed
additional_tasks_required:
  - ...
```

The Lead decides whether additional work should be created.

```
```
