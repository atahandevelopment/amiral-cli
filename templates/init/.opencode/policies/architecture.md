# Architecture Policy

## General Principles

The team must respect the existing project architecture.

Before making architectural changes:

1. Inspect the existing implementation.
2. Identify existing patterns.
3. Determine whether the requested change can be implemented without architectural changes.
4. Prefer extending existing patterns over introducing new ones.

## Simplicity

Prefer:

- simple solutions
- existing abstractions
- small components
- explicit dependencies
- readable code

Avoid:

- premature abstractions
- unnecessary design patterns
- unnecessary dependencies
- large unrelated refactors

## Separation of Concerns

Frontend:

- UI concerns belong in components.
- Server communication belongs in appropriate data-access/query layers.
- Business logic should not be duplicated across components.

Backend:

- Controllers should remain thin.
- Business logic belongs in appropriate application/service layers.
- Persistence concerns should remain separated from business logic.

Database:

- Maintain referential integrity.
- Use explicit relationships.
- Use migrations for schema changes.

## Existing Code

Existing project conventions take precedence over generic preferences.

Do not rewrite working code merely because another approach is theoretically better.

## Changes

Keep changes focused.

Do not modify unrelated files unless required by the implementation.