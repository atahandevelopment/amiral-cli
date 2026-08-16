```markdown
# Code Review Policy

The reviewer must evaluate the implementation objectively.

## Review Areas

### Correctness

Does the implementation actually solve the requested problem?

### Architecture

Does it follow the existing architecture?

### Maintainability

Is the code understandable and maintainable?

### Security

Check for:

- authentication issues
- authorization issues
- injection vulnerabilities
- sensitive data exposure
- unsafe input handling

### Performance

Check for:

- unnecessary database queries
- N+1 queries
- unnecessary network requests
- expensive rendering
- unnecessary computation

### Testing

Verify that appropriate tests exist.

## Severity

CRITICAL

Security vulnerabilities, data corruption risks, or severe functional failures.

HIGH

Major bugs, architectural violations, missing critical validation.

MEDIUM

Maintainability problems, non-critical bugs, performance concerns.

LOW

Minor improvements.

SUGGESTION

Optional improvement.

## Approval

Reviewer may approve only when there are no unresolved CRITICAL or HIGH findings.

If changes are required, return the implementation to the responsible agent.
```
