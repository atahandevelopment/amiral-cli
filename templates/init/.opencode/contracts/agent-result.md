````markdown
# Agent Result Contract

This contract defines the standard response returned by implementation and specialist agents.

Every completed task should produce a structured result.

---

# Required Fields

## task_id

The ID of the task that was executed.

Example:

```yaml
task_id: API-001
````

---

## status

Allowed values:

```text
completed
failed
blocked
```

---

## summary

Short description of what was done.

---

## files_changed

List of files created, modified or deleted.

Example:

```yaml
files_changed:
  - src/api/auth/login.ts
  - tests/auth/login.test.ts
```

---

## tests

List of validation commands or tests executed.

Example:

```yaml
tests:
  - npm run lint
  - npm run typecheck
  - npm test
```

---

## issues

Known issues discovered during implementation.

Use:

```yaml
issues: []
```

when there are none.

---

# Optional Fields

## skills_used

Skills actually loaded and used during the task.

Example:

```yaml
skills_used:
  - authentication
  - api-design
```

---

## implementation_notes

Important technical details.

---

## risks

Potential risks introduced or discovered.

---

## additional_tasks_required

Tasks that may need to be created after completion.

Example:

```yaml
additional_tasks_required:
  - Add integration test for OAuth callback
```

---

## next_action

Recommended next orchestration step.

Example:

```yaml
next_action:
  type: review
```

Allowed values:

```text
review
qa
continue
retry
blocked
```

---

# Completed Example

```yaml
task_id: API-001

status: completed

summary: >
  Implemented the authentication API using the existing
  backend authentication architecture.

files_changed:
  - src/api/auth/login.ts
  - src/api/auth/register.ts
  - tests/auth/login.test.ts

tests:
  - npm run lint
  - npm run typecheck
  - npm test

skills_used:
  - authentication
  - api-design
  - security

issues: []

implementation_notes:
  - Reused the existing authentication service.
  - No new dependencies were introduced.

risks: []

additional_tasks_required: []

next_action:
  type: review
```

---

# Failed Example

```yaml
task_id: API-001

status: failed

summary: >
  Authentication endpoint could not be implemented because
  the required database migration is missing.

files_changed:
  - src/api/auth/login.ts

tests:
  - npm test

issues:
  - Database schema required by the authentication service does not exist.

skills_used:
  - authentication

implementation_notes: []

risks:
  - Authentication cannot work until the database schema is available.

additional_tasks_required:
  - Create authentication database migration

next_action:
  type: blocked
```

---

# Blocked Example

```yaml
task_id: API-001

status: blocked

summary: >
  Implementation is blocked by an unresolved architecture decision.

files_changed: []

tests: []

issues:
  - Existing authentication providers conflict with the requested implementation.

skills_used:
  - authentication

implementation_notes: []

risks:
  - Proceeding without resolving the architecture would create duplicate authentication logic.

additional_tasks_required:
  - Decide whether the existing provider should be extended or replaced.

next_action:
  type: blocked
```

---

# Result Rules

Agents must never claim success when validation fails.

If required tests fail:

```yaml
status: failed
```

If implementation cannot safely continue:

```yaml
status: blocked
```

Do not hide warnings, test failures or unresolved risks.

```
```
