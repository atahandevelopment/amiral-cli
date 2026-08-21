# tasks/

This directory is the persistent execution workspace for OpenCode AI Team.

Each workflow receives its own directory:

```text
tasks/
├── .active-workflow
└── feature-auth-a1b2c3d4/
    ├── task-graph.json
    ├── state.json
    ├── history.json
    └── results/
        ├── DB-001.json
        ├── API-001.json
        └── QA-001.json
```

## Responsibilities

- `task-graph.json`: immutable snapshot of the Planner output used to start the workflow.
- `state.json`: current workflow and task states.
- `history.json`: append-only logical event history.
- `results/`: validated structured results returned by agents.
- `.active-workflow`: identifies the workflow used by commands when no workflow ID is supplied.

This makes `tasks/` the source of truth for active and previous workflow executions.
