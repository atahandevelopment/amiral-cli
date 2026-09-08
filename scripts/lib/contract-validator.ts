import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = process.cwd();

const SCHEMAS = {
  "agent-result": resolve(ROOT, ".opencode/schemas/agent-result.schema.json"),
  "execution-request": resolve(
    ROOT,
    ".opencode/schemas/execution-request.schema.json",
  ),
  "quality-gate": resolve(ROOT, ".opencode/schemas/quality-gate.schema.json"),
  "planner-result": resolve(
    ROOT,
    ".opencode/schemas/planner-result.schema.json",
  ),
  "design-spec": resolve(ROOT, ".opencode/schemas/design-spec.schema.json"),
} as const;

// Schemas that reference other schemas via $id must be compiled
// together with their dependencies.
const SCHEMA_DEPENDENCIES: Record<SchemaName, string[]> = {
  "agent-result": [],
  "execution-request": [],
  "quality-gate": [],
  "planner-result": [resolve(ROOT, ".opencode/schemas/task.schema.json")],
  "design-spec": [],
};

type SchemaName = keyof typeof SCHEMAS;

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) {
    return "Unknown schema validation error.";
  }

  return errors
    .map((error) => {
      const path = error.instancePath || "/";
      return `${path}: ${error.message ?? "invalid value"}`;
    })
    .join("; ");
}

export async function validateContract(
  schemaName: SchemaName,
  value: unknown,
): Promise<void> {
  const dependencyFiles = SCHEMA_DEPENDENCIES[schemaName] ?? [];

  const [schema, ...dependencySchemas] = await Promise.all([
    readFile(SCHEMAS[schemaName], "utf8"),
    ...dependencyFiles.map((file) => readFile(file, "utf8")),
  ]);

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  for (const dependencySchema of dependencySchemas) {
    ajv.addSchema(JSON.parse(dependencySchema));
  }

  const validate = ajv.compile(JSON.parse(schema));

  if (!validate(value)) {
    throw new Error(
      `${schemaName} validation failed: ${formatErrors(validate.errors)}`,
    );
  }
}
