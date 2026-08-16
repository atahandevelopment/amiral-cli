export type AgentName =
  | "planner"
  | "frontend"
  | "backend"
  | "database"
  | "devops"
  | "reviewer"
  | "qa";

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type WorkflowStatus =
  | "planned"
  | "running"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled";

export type WorkflowType = "feature" | "bugfix" | "refactor";

export type SourceTask = {
  id: string;
  title: string;
  agent: AgentName;
  description: string;
  dependencies: string[];
  acceptance_criteria: string[];
};

export type TaskGraph = {
  tasks: SourceTask[];
};

export type RuntimeTask = SourceTask & {
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  result_file: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
};

export type WorkflowState = {
  workflow_id: string;
  workflow_type: WorkflowType;
  status: WorkflowStatus;
  created_at: string;
  updated_at: string;
  source_graph: string;
  tasks: RuntimeTask[];
};

export type HistoryEventName =
  | "workflow_created"
  | "workflow_status_changed"
  | "task_status_changed"
  | "task_result_attached"
  | "task_claimed"
  | "task_retried"
  | "task_lease_expired";

export type HistoryEvent = {
  timestamp: string;
  workflow_id: string;
  event: HistoryEventName;
  task_id?: string | null;
  message: string;
};
