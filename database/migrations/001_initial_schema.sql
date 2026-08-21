-- OpenCode AI Team - Initial Schema Migration
-- Version: 001
-- Date: 2026-08-18

BEGIN;

-- Enum types for status fields
CREATE TYPE task_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'failed',
    'blocked',
    'cancelled'
);

CREATE TYPE workflow_status AS ENUM (
    'planned',
    'running',
    'blocked',
    'failed',
    'completed',
    'cancelled'
);

CREATE TYPE workflow_type AS ENUM (
    'feature',
    'bugfix',
    'refactor'
);

CREATE TYPE agent_name AS ENUM (
    'planner',
    'frontend',
    'backend',
    'database',
    'devops',
    'reviewer',
    'qa'
);

CREATE TYPE history_event_name AS ENUM (
    'workflow_created',
    'workflow_status_changed',
    'task_status_changed',
    'task_result_attached',
    'task_claimed',
    'task_retried',
    'task_lease_expired'
);

-- Workflows table
CREATE TABLE workflows (
    id VARCHAR(255) PRIMARY KEY,
    workflow_type workflow_type NOT NULL,
    status workflow_status NOT NULL DEFAULT 'planned',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_graph VARCHAR(500) NOT NULL
);

-- Tasks table
CREATE TABLE tasks (
    id VARCHAR(255) PRIMARY KEY,
    workflow_id VARCHAR(255) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    agent agent_name NOT NULL,
    description TEXT NOT NULL,
    dependencies JSONB NOT NULL DEFAULT '[]',
    acceptance_criteria JSONB NOT NULL DEFAULT '[]',
    status task_status NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error TEXT,
    result_file VARCHAR(500),
    lease_id VARCHAR(255),
    lease_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- History events table for audit trail
CREATE TABLE history_events (
    id BIGSERIAL PRIMARY KEY,
    workflow_id VARCHAR(255) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    task_id VARCHAR(255) REFERENCES tasks(id) ON DELETE CASCADE,
    event history_event_name NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_tasks_workflow_id ON tasks(workflow_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_agent ON tasks(agent);
CREATE INDEX idx_history_events_workflow_id ON history_events(workflow_id);
CREATE INDEX idx_history_events_task_id ON history_events(task_id);
CREATE INDEX idx_history_events_created_at ON history_events(created_at);

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
