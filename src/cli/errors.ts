export const EXIT = { SUCCESS: 0, GENERAL: 1, USAGE: 2, CONFIG: 3, WORKFLOW_BLOCKED: 4, PROVIDER: 5, VALIDATION: 6, INTERRUPTED: 130 } as const;
export class CliError extends Error { constructor(message: string, public readonly exitCode: number = EXIT.GENERAL, public readonly details?: unknown) { super(message); this.name = "CliError"; } }
export class UsageCliError extends CliError { constructor(message: string) { super(message, EXIT.USAGE); this.name = "UsageCliError"; } }
export class ConfigCliError extends CliError { constructor(message: string) { super(message, EXIT.CONFIG); this.name = "ConfigCliError"; } }
export class ValidationCliError extends CliError { constructor(message: string, details?: unknown) { super(message, EXIT.VALIDATION, details); this.name = "ValidationCliError"; } }
export class WorkflowBlockedCliError extends CliError { constructor(message: string) { super(message, EXIT.WORKFLOW_BLOCKED); this.name = "WorkflowBlockedCliError"; } }
export function mapError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const value = error instanceof Error ? error : new Error(String(error));
  const name = value.name;
  let mapped: CliError;
  if (name === "ProviderError") mapped = new CliError(value.message, EXIT.PROVIDER);
  else if (name === "AdminError" || name === "LockError") mapped = new WorkflowBlockedCliError(value.message);
  else if (/team\.yaml|config|ENOENT.*team/i.test(value.message)) mapped = new ConfigCliError(value.message);
  else if (/valid|schema|must be|required/i.test(value.message)) mapped = new ValidationCliError(value.message);
  else mapped = new CliError(value.message);
  mapped.stack = value.stack;
  return mapped;
}
