# Database Schema

This directory contains PostgreSQL schema migrations for the OpenCode AI Team workflow orchestration system.

## Overview

The schema provides persistent storage for workflows and tasks, replacing the current file-based JSON storage with a relational database.

## Tables

### workflows
Stores workflow instances with their metadata and status.

### tasks
Stores individual tasks within workflows, including their execution state, dependencies, and results.

### history_events
Audit trail of all state changes for workflows and tasks.

## Migrations

Migrations are stored in the `migrations/` directory and numbered sequentially:

- `001_initial_schema.sql` - Creates the initial schema with all tables, enums, indexes, and triggers.

## Usage

### Running Migrations

```bash
# Using psql
psql -d opencode_ai_team -f database/migrations/001_initial_schema.sql

# Using a migration tool (e.g., golang-migrate, flyway, etc.)
migrate -path database/migrations -database "postgres://localhost/opencode_ai_team?sslmode=disable" up
```

### Connecting

```bash
# Connect to the database
psql -d opencode_ai_team
```

## Schema Design Principles

1. **Normalization**: Tables are normalized to reduce data redundancy
2. **Referential Integrity**: Foreign keys with CASCADE deletes ensure data consistency
3. **Indexing**: Indexes on frequently queried columns (workflow_id, status, timestamps)
4. **Audit Trail**: History events table provides complete audit trail of state changes
5. **Automatic Timestamps**: Triggers automatically update `updated_at` columns
6. **Enum Types**: Status fields use PostgreSQL enum types for data integrity
7. **JSONB for Flexible Data**: Dependencies and acceptance criteria stored as JSONB for flexibility
