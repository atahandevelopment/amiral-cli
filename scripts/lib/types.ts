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
  | "retry_wait"
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

/**
 * Structured diagnostic for the last provider failure observed for a task.
 * Persisted so retry decisions and diagnostics survive process restarts.
 */
export type LastProviderError = {
  provider: string;
  kind: string;
  message: string;
  retryable: boolean;
  status_code?: number;
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
  /**
   * Retry scheduling (Phase 13). While status is "retry_wait" the task
   * becomes eligible again only once this ISO timestamp has passed.
   * Persisted in workflow state; no in-memory timers are involved.
   */
  retry_not_before?: string | null;
  last_provider_error?: LastProviderError | null;
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
  | "workflow_cancelled"
  | "task_status_changed"
  | "task_result_attached"
  | "task_claimed"
  | "task_retried"
  | "task_lease_expired"
  | "provider_retry_scheduled"
  | "provider_failure"
  | "provider_recovered";

export type HistoryEvent = {
  timestamp: string;
  workflow_id: string;
  event: HistoryEventName;
  task_id?: string | null;
  message: string;
  /**
   * Optional structured payload (provider, error kind, retryable, attempt,
   * next retry time) introduced in Phase 13 for observability.
   */
  details?: Record<string, unknown>;
};
