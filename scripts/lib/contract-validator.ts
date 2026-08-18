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
} as const;

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
  const schema = JSON.parse(
    await readFile(SCHEMAS[schemaName], "utf8"),
  ) as object;

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  const validate = ajv.compile(schema);

  if (!validate(value)) {
    throw new Error(
      `${schemaName} validation failed: ${formatErrors(validate.errors)}`,
    );
  }
}
