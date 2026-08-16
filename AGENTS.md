```markdown
# AI Agent Team

This repository is operated by a coordinated AI software development team.

The team consists of:

- Lead
- Planner
- Frontend
- Backend
- Database
- Reviewer
- QA

---

# Core Principle

Agents must inspect the existing repository before making architectural or implementation decisions.

Do not assume that a technology, pattern or architecture exists without verifying it.

Prefer existing project conventions over introducing new patterns.

---

# Agent Responsibilities

## Lead

Responsible for:

- requirement analysis
- workflow selection
- orchestration
- task dependencies
- delegation
- review coordination
- QA coordination

## Planner

Responsible for:

- repository analysis
- architecture analysis
- task decomposition
- dependency analysis
- acceptance criteria

Planner does not implement source code.

## Frontend

Responsible for frontend implementation.

## Backend

Responsible for backend implementation.

## Database

Responsible for database implementation.

## Reviewer

Responsible for code review.

Reviewer does not modify implementation code.

## QA

Responsible for testing and validation.

---

# Workflows

Use the appropriate workflow:

Feature:

`.opencode/workflows/feature.md`

Bug fix:

`.opencode/workflows/bugfix.md`

Refactoring:

`.opencode/workflows/refactor.md`

---

# Policies

Follow the appropriate policy files:

`.opencode/policies/architecture.md`

`.opencode/policies/coding.md`

`.opencode/policies/testing.md`

`.opencode/policies/git.md`

`.opencode/policies/review.md`

---

# Skills

Skills are reusable specialized instructions.

Agents should discover and load relevant skills using the native `skill` tool.

Do not load unrelated skills.

Skills do not replace:

- workflows
- policies
- agent responsibilities

---

# Task Delegation

Non-trivial tasks should be delegated to the appropriate specialist agent.

Respect dependencies defined by the Planner.

Independent tasks may run in parallel when safe.

---

# Repository Safety

Never:

- overwrite unrelated user changes
- discard user work
- expose secrets
- hardcode credentials
- perform destructive Git operations without explicit approval

Inspect Git state before significant modifications.

---

# Completion

A non-trivial task is complete only after:

1. Implementation
2. Integration
3. Code review
4. QA

have successfully completed.

Never claim completion when known blocking issues remain.
```
