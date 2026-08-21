```markdown
# Testing Policy

Every implementation must be validated.

## Required Validation

Depending on the affected area, run:

- unit tests
- integration tests
- end-to-end tests
- type checking
- linting
- build

## Before Completion

A task must not be marked complete if:

- tests are failing
- type checking fails
- build fails
- linting has critical errors
- known critical regressions exist

## New Features

New behavior should have appropriate automated tests.

Tests should verify:

1. Expected behavior
2. Error behavior
3. Important edge cases
4. Regression scenarios

## Bug Fixes

Every bug fix should preferably include a regression test.

The test should reproduce the original problem and verify the fix.

## QA

QA is responsible for final validation.

Developers are responsible for validating their own changes before requesting review.
```
