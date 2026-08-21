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

export type CapabilityRouting = {
  mode: "fixed" | "auto";
  required_capabilities?: string[];
  preferred_agents?: AgentName[];
};

export type TaskPlanningPriority =
  | "low"
  | "normal"
  | "high"
  | "critical";

export type TaskPlanningComplexity = "small" | "medium" | "large";

export type TaskPlanningRisk = "low" | "medium" | "high";

export type TaskPlanningMetadata = {
  priority?: TaskPlanningPriority;
  estimated_complexity?: TaskPlanningComplexity;
  risk?: TaskPlanningRisk;
  expected_files?: string[];
  conflict_domains?: string[];
  parallel_group?: string;
};

export type SourceTask = {
  id: string;
  title: string;
  agent: AgentName;
  description: string;
  dependencies: string[];
  acceptance_criteria: string[];
  routing?: CapabilityRouting;
  planning?: TaskPlanningMetadata;
};

export type TaskGraph = {
  tasks: SourceTask[];
};

export type RuntimeTask = SourceTask & {
  status: TaskStatus;
  attempts: number;
  /**
   * Lease fields are assigned by the scheduler when a task is claimed and
   * are absent on freshly created tasks.
   */
  max_attempts?: number;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  result_file: string | null;
  lease_id?: string | null;
  lease_expires_at?: string | null;
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
