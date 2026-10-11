import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import { createHash } from "node:crypto";

const Ajv = AjvModule.default ?? AjvModule;
const addFormats = addFormatsModule.default ?? addFormatsModule;
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});

addFormats(ajv);

interface CachedValidator {
  schemaFingerprint: string;
  validate: ValidateFunction;
}

// Each immutable ToolVersion ID maps to its schema fingerprint and validator.
const validatorCache = new Map<string, CachedValidator>();

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

/**
 * Returns true when the value is a non-null JSON-schema object.
 */
function isSchemaObject(schema: unknown): schema is Record<string, unknown> {
  return (
    schema !== null && typeof schema === "object" && !Array.isArray(schema)
  );
}

/**
 * Creates a stable fingerprint for JSON-compatible schema objects.
 * Object keys are sorted recursively so equivalent key ordering does not
 * produce different fingerprints.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();

    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }

  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error("Schema contains a non-JSON-compatible value.");
  }

  return serialized;
}

function fingerprintSchema(schema: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(schema)).digest("hex");
}

/**
 * Formats AJV errors into concise diagnostic strings.
 */
function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return ["Unknown schema validation error."];
  }

  return errors.map((error) => {
    const path = error.instancePath === "" ? "(root)" : error.instancePath;

    return `Field "${path}": ${error.message ?? "invalid value"}`;
  });
}

/**
 * Validates that a schema is an object and can be compiled by AJV.
 *
 * This checks compilation compatibility; it does not validate a payload.
 */
export function assertValidJsonSchema(schema: unknown): void {
  if (!isSchemaObject(schema)) {
    throw new Error("Tool inputJsonSchema must be a non-null JSON object.");
  }

  try {
    ajv.compile(schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Invalid or unsupported JSON Schema: ${message}`);
  }
}

/**
 * Validates a payload against the schema belonging to the exact ToolVersion.
 *
 * Always pass the schema retrieved for this toolVersionId from the registry.
 * If the same ID is presented with a different schema, validation fails
 * rather than silently using a stale cached validator.
 */
export function validateToolPayload(
  toolVersionId: string,
  inputJsonSchema: unknown,
  payload: unknown,
): ValidationOutcome {
  if (!toolVersionId.trim()) {
    return {
      valid: false,
      errors: ["toolVersionId must be a non-empty string."],
    };
  }

  if (!isSchemaObject(inputJsonSchema)) {
    return {
      valid: false,
      errors: [
        `Corrupted schema definition for toolVersionId "${toolVersionId}".`,
      ],
    };
  }

  let schemaFingerprint: string;

  try {
    schemaFingerprint = fingerprintSchema(inputJsonSchema);
  } catch (error) {
    return {
      valid: false,
      errors: [
        `Failed to fingerprint schema for version "${toolVersionId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  let cached = validatorCache.get(toolVersionId);

  if (cached && cached.schemaFingerprint !== schemaFingerprint) {
    return {
      valid: false,
      errors: [
        `Schema mismatch for toolVersionId "${toolVersionId}". ` +
          "A ToolVersion schema must remain immutable.",
      ],
    };
  }

  if (!cached) {
    try {
      const validate = ajv.compile(inputJsonSchema);

      cached = {
        schemaFingerprint,
        validate,
      };

      validatorCache.set(toolVersionId, cached);
    } catch (error) {
      return {
        valid: false,
        errors: [
          `Failed to compile JSON schema for version "${toolVersionId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  }

  const valid = cached.validate(payload);

  if (valid) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: formatAjvErrors(cached.validate.errors),
  };
}

/**
 * Clears compiled validators. Primarily useful for isolated tests.
 */
export function clearValidatorCache(): void {
  validatorCache.clear();
}
