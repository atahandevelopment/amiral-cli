```markdown
# Git Policy

## General

Always inspect the current Git state before making changes.

Check:

- current branch
- working tree
- existing changes

Never overwrite unrelated user changes.

## Changes

Keep commits focused when commits are requested.

Do not mix:

- feature implementation
- unrelated refactoring
- formatting-only changes

in the same logical change.

## Branches

Do not modify the main branch directly unless explicitly instructed.

Prefer a dedicated feature or bugfix branch.

## Destructive Operations

Never execute destructive Git commands without explicit approval.

Examples:

- git reset --hard
- git clean -fd
- force push
- deleting branches containing unmerged work

## Existing Changes

If unrelated uncommitted changes exist:

- preserve them
- do not modify them
- do not include them in the task

## Completion

Before reporting completion:

- inspect git diff
- verify changed files
- verify no accidental modifications exist
```
