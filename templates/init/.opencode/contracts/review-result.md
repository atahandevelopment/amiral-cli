````markdown
# Review Result Contract

This contract defines the standard output of the Reviewer Agent.

---

# Verdict

The Reviewer must return exactly one of:

```text
PASS
CHANGES_REQUESTED
BLOCKED
````

---

# Required Fields

## task_id

The task or implementation being reviewed.

---

## verdict

One of:

```text
PASS
CHANGES_REQUESTED
BLOCKED
```

---

## findings

List of review findings.

Use:

```yaml
findings: []
```

when no findings exist.

Each finding should contain:

* severity
* file
* description
* recommendation

---

# Severity

Allowed values:

```text
critical
high
medium
low
```

---

# Example

```yaml
task_id: REVIEW-001

verdict: CHANGES_REQUESTED

findings:

  - severity: high
    file: src/api/auth/login.ts
    description: >
      Login attempts are not rate limited.

    recommendation: >
      Add rate limiting using the existing security infrastructure.

  - severity: medium
    file: tests/auth/login.test.ts
    description: >
      Invalid credential behavior is not covered.

    recommendation: >
      Add a regression test for invalid credentials.

summary: >
  The implementation is functionally close to complete,
  but security and test coverage issues must be addressed.

required_actions:

  - agent: backend
    action: Add authentication rate limiting.

  - agent: qa
    action: Add invalid credential regression test.
```

---

# PASS Example

```yaml
task_id: REVIEW-001

verdict: PASS

findings: []

summary: >
  The implementation satisfies the requirements and follows
  the existing project architecture.

required_actions: []
```

---

# BLOCKED Example

```yaml
task_id: REVIEW-001

verdict: BLOCKED

findings:

  - severity: critical
    file: src/api/auth/
    description: >
      Authentication implementation exposes sensitive credentials.

    recommendation: >
      Stop the implementation and redesign the authentication flow.

summary: >
  The implementation cannot safely proceed.

required_actions:
  - agent: backend
    action: Redesign the authentication implementation.
```

---

# Review Rules

The Reviewer must:

1. Inspect the actual changes.
2. Compare implementation against the original task.
3. Inspect related code when necessary.
4. Check relevant policies.
5. Load relevant review and security skills.
6. Identify concrete problems.
7. Avoid subjective criticism without technical justification.

---

# Review Completion

`PASS` means the implementation can proceed to QA.

`CHANGES_REQUESTED` means the responsible agent must make corrections.

`BLOCKED` means the Lead must intervene before implementation can continue.

A critical finding must never be ignored.

```
```
